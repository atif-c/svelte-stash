import { debounce, type DebouncedFunction, type DebounceOptions } from 'debounce-ts';

export type { DebounceOptions };

/**
 * Reactive state manager with storage sync for Svelte 5.
 * Loads storage into `$state` and saves edits back through debounced callbacks.
 *
 * Source: {@link https://github.com/atif-c/svelte-stash atif-c/svelte-stash}
 *
 * Type constraints:
 * - `T` must be structured-cloneable. Values that cannot be cloned
 *   (functions, DOM nodes, some class instances) throw on clone.
 *
 * Reactivity notes:
 * - `state` stays `undefined` until `load()` runs.
 * - After loading, `state` is a `$state` object. Edit its fields (e.g. `settings.state!.theme = 'dark'`)
 *   to trigger reactivity. Check for `undefined` first. Read outside Svelte through `$state.snapshot`.
 *
 * @template T - The shape of the managed state object (must be an object with string keys)
 *
 * @example
 * ```typescript
 * import { Stash } from 'svelte-stash';
 *
 * interface UserSettings {
 * 	theme: 'light' | 'dark';
 * 	language: string;
 * 	notifications: boolean;
 * }
 *
 * // Syncs in-memory state with localStorage
 * const settings = new Stash<UserSettings>(
 * 	// Load callback: reads state from storage
 * 	async () => {
 * 		const saved = localStorage.getItem('userSettings');
 * 		return saved
 * 			? JSON.parse(saved)
 * 			: {
 * 					theme: 'dark',
 * 					language: 'en',
 * 					notifications: true
 * 				};
 * 	},
 * 	// Save callback: writes state to storage
 * 	async data => {
 * 		localStorage.setItem('userSettings', JSON.stringify(data));
 * 	},
 * 	// Debounce options: limits storage writes
 * 	{ delay: 500, maxWait: 2000 }
 * );
 *
 * // Initialise: loads storage into state
 * await settings.load();
 * ```
 */
export class Stash<T extends object> {
	state = $state<T>();
	#loadCallback: () => T | Promise<T>;
	#saveCallback?: (storage: T) => void | Promise<void>;
	readonly #debounceOptions: Readonly<DebounceOptions>;

	/** Debounced save runner. Null without a save callback. */
	#debouncedSave: DebouncedFunction<[]> | null = null;

	/** Tracks destruction. Blocks later loads and saves. */
	#destroyed = false;

	/** Resolves when the pending save completes. */
	#pendingSavePromise: Promise<void> | null = null;

	/** Resolves the pending save promise. */
	#resolvePendingSave: (() => void) | null = null;

	/** Serializes overlapping saves. Keeps the idle path synchronous. */
	#saveInFlight: Promise<void> | null = null;

	/**
	 * Creates a stash with load and save callbacks and debounce options.
	 *
	 * @param loadCallback - Returns the full state object. Runs sync or async.
	 * @param saveCallback - Optional. Persists a snapshot of state. Runs sync or async.
	 * @param debounceOptions - Optional. Defaults to `{ delay: 0, immediate: false }`.
	 *   Leaves `maxWait` unset unless provided: `debounce-ts` needs `maxWait >= delay`
	 *   and reads `0` as set, so a forced `0` default throws when `delay > 0`.
	 *
	 * @throws {Error} Rethrows debounce setup errors.
	 *
	 * @example
	 * ```typescript
	 * // Minimal storage-backed stash
	 * const stash = new Stash(
	 *   () => JSON.parse(localStorage.getItem('data') || '{}'),
	 *   (data) => localStorage.setItem('data', JSON.stringify(data)),
	 *   { delay: 1000, maxWait: 5000 }
	 * );
	 * ```
	 */
	constructor(
		loadCallback: () => Promise<T> | T,
		saveCallback?: (state: T) => Promise<void> | void,
		debounceOptions?: DebounceOptions
	) {
		this.#loadCallback = loadCallback;
		this.#saveCallback = saveCallback;
		this.#debounceOptions = {
			delay: debounceOptions?.delay ?? 0,
			immediate: debounceOptions?.immediate ?? false,
			...(debounceOptions?.maxWait !== undefined && { maxWait: debounceOptions.maxWait }),
			...(debounceOptions?.onError && { onError: debounceOptions.onError })
		};

		if (this.#saveCallback) {
			this.#debouncedSave = debounce(async () => {
				const previous = this.#saveInFlight;
				const runSave = (async () => {
					// Waits for the in-flight save first; its error stays with its own run.
					if (previous) {
						try {
							await previous;
						} catch {
							/* The previous run surfaces its own error. */
						}
					}
					if (!this.state) {
						throw new Error('save() was called before load() resolved');
					}

					// Snapshots state now, so later edits cannot corrupt the write.
					const stateSnapshot = $state.snapshot(this.state) as T;
					await this.#saveCallback!(stateSnapshot);
				})();

				// Tracks order without turning a failure into an unhandled rejection.
				const tracker = runSave.catch(() => {});
				this.#saveInFlight = tracker;

				try {
					await runSave; // Rethrows, so debounce-ts routes the error to onError.
				} finally {
					if (this.#saveInFlight === tracker) {
						this.#saveInFlight = null;
					}
					// Resolves the save promise after success or error.
					if (this.#resolvePendingSave) {
						this.#resolvePendingSave();
						this.#pendingSavePromise = null;
						this.#resolvePendingSave = null;
					}
				}
			}, this.#debounceOptions);
		}
	}

	/**
	 * Loads storage into state through the load callback.
	 *
	 * Clones the result with `structuredClone`, so state and storage share no references.
	 * Updates arrays and objects in place to keep references. Replaces state on first load or type change.
	 * Drops object keys missing from the loaded data.
	 *
	 * @returns Promise for completion. State holds the loaded data after it resolves.
	 *
	 * @throws {Error} Rethrows load callback errors and clone failures.
	 *
	 * @example
	 * ```typescript
	 * const stash = new Stash(loadFn, saveFn);
	 * await stash.load(); // Initialise state from storage
	 * console.log(stash.state); // Holds the loaded data
	 * ```
	 */
	load = async (): Promise<void> => {
		if (this.#destroyed) {
			return;
		}
		const loadedData = await this.#loadCallback();
		let cleanData: T;
		try {
			cleanData = structuredClone(loadedData);
		} catch (error) {
			throw new Error(
				'Failed to clone loaded data in load(). This typically happens when loadCallback returns a non-cloneable value',
				{ cause: error }
			);
		}

		// Rechecks destruction after `await`. Blocks writes after `destroy()`.
		if (this.#destroyed) {
			return;
		}

		if (this.state && Array.isArray(this.state) && Array.isArray(cleanData)) {
			// Updates arrays in place. Keeps references.
			this.state.length = 0;
			this.state.push(...cleanData);
		} else if (this.state && !Array.isArray(this.state) && !Array.isArray(cleanData)) {
			// Updates objects in place. Drops stale keys.
			for (const key of Object.keys(this.state)) {
				if (!Object.prototype.hasOwnProperty.call(cleanData as object, key)) {
					delete (this.state as Record<string, unknown>)[key];
				}
			}
			Object.assign(this.state, cleanData);
		} else {
			// Replaces state on first load or type change.
			this.state = cleanData;
		}
	};

	/**
	 * Saves state to storage through the save callback (debounced).
	 *
	 * Does nothing without a save callback. Passes a snapshot, so later edits cannot corrupt the write.
	 * Repeated calls share one promise. Use {@link flush} to run now. Use {@link cancel} to drop the save.
	 *
	 * @throws {Error} Without `onError`, save errors surface as unhandled rejections.
	 *
	 * @example
	 * ```typescript
	 * settings.state!.theme = 'dark';
	 * await settings.save();
	 * ```
	 */
	save = (): Promise<void> => {
		if (this.#destroyed) {
			return Promise.resolve();
		}
		if (this.#debouncedSave) {
			if (!this.#pendingSavePromise) {
				this.#pendingSavePromise = new Promise(resolve => {
					this.#resolvePendingSave = resolve;
				});
			}
			this.#debouncedSave();
			return this.#pendingSavePromise;
		}
		return Promise.resolve();
	};

	/**
	 * Runs any pending save at once and clears timers.
	 *
	 * Call before page unload, navigation or shutdown. Without a pending save,
	 * returns a resolved promise.
	 *
	 * @returns Promise for completion of the pending save.
	 *
	 * @example
	 * ```typescript
	 * window.addEventListener('beforeunload', () => {
	 * 	void settings.flush();
	 * });
	 * ```
	 */
	flush = (): Promise<void> => {
		if (this.#debouncedSave) {
			this.#debouncedSave.flush();
			return this.#pendingSavePromise || Promise.resolve();
		}
		return Promise.resolve();
	};

	/**
	 * Drops any pending save without persisting.
	 *
	 * Call to discard edits, then `load()` to restore storage.
	 *
	 * @example
	 * ```typescript
	 * async function discardChanges() {
	 * 	settings.cancel();
	 * 	await settings.load();
	 * }
	 * ```
	 */
	cancel = (): void => {
		if (this.#debouncedSave) {
			this.#debouncedSave.cancel();
		}
	};

	/**
	 * Cancels pending saves and resets state to `undefined`.
	 *
	 * Call on cleanup (for example component unmount) to avoid leaks.
	 * Do not reuse the stash after this call.
	 *
	 * @example
	 * ```typescript
	 * // In a Svelte component
	 * onDestroy(() => {
	 * 	settings.destroy();
	 * });
	 * ```
	 */
	destroy = (): void => {
		this.#destroyed = true;
		this.cancel();
		this.#debouncedSave = null;
		this.state = undefined;
		this.#saveInFlight = null;
	};

	/**
	 * Returns a plain snapshot of `state` for serialization.
	 *
	 * `state` hides behind a `$state` accessor, so `JSON.stringify` and spreads skip it.
	 * This method exposes the snapshot instead.
	 *
	 * @example
	 * ```typescript
	 * JSON.stringify(settings); // Serializes the snapshot, not internal fields
	 * ```
	 */
	toJSON(): T | undefined {
		return this.state === undefined ? undefined : ($state.snapshot(this.state) as T);
	}
}
