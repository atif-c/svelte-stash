import { debounce, type DebouncedFunction, type DebounceOptions } from 'debounce-ts';

export type { DebounceOptions };

/**
 * Svelte 5 generic state management utility for managing reactive object state with automatic persistence.
 * Provides asynchronous loading and saving of state via callbacks, with built-in
 * debouncing to optimize save operations and prevent excessive writes.
 *
 * Source: {@link https://github.com/atif-c/svelte-stash atif-c/svelte-stash}
 *
 *  Type constraints:
 * - `T` must be structured-cloneable/serializable. Values that cannot be cloned
 *   (functions, DOM nodes, certain class instances) will throw or lose behavior.
 *
 * Reactivity notes:
 * - `state` is initially `undefined` until `load()` is called.
 * - After loading, `state` is a `$state` object. Mutate its fields (e.g. `stash.state!.theme = 'dark'`)
 *   to trigger reactivity. Use `$state.snapshot(stash.state)` to read a non-reactive snapshot.
 *
 * Features:
 * - Reactive state updates using Svelte's $state rune
 * - Automatic debounced saving to prevent excessive writes
 * - Deep cloning to prevent reference mutations
 * - Configurable debounce timing with immediate execution support
 * - Comprehensive error handling with logging
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
 * // Create a state stash that syncs in-memory state with localStorage
 * const settingsStash = new Stash<UserSettings>(
 * 	// Load callback - retrieves state from storage
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
 * 	// Save function - persist state changes
 * 	async data => {
 * 		localStorage.setItem('userSettings', JSON.stringify(data));
 * 	},
 * 	// Debounce options - optimize storage writes
 * 	{ delay: 500, maxWait: 2000 }
 * );
 *
 * // Initialise: Load from persistent storage into reactive memory
 * await settingsStash.load();
 * ```
 */
export class Stash<T extends object> {
	state = $state<T>();
	#loadCallback: () => T | Promise<T>;
	#saveCallback?: (storage: T) => void | Promise<void>;
	readonly #debounceOptions: Readonly<DebounceOptions>;

	/** Debounced version of the save function, created during initialisation */
	#debouncedSave: DebouncedFunction<[]> | null = null;

	/** Flag to track if the stash has been destroyed */
	#destroyed = false;

	/** Promise that resolves when pending save completes */
	#pendingSavePromise: Promise<void> | null = null;

	/** Resolver function for pending save promise */
	#resolvePendingSave: (() => void) | null = null;

	/** Queue for serializing concurrent saves to prevent out-of-order persistence */
	#saveQueue: Promise<void> = Promise.resolve();

	/**
	 * Creates a new Stash instance with load/save callbacks and debounce configuration.
	 *
	 * @param loadCallback - Sync or async function that retrieves the initial state object
	 * @param saveCallback - Optional sync or async function to persist state changes
	 *   Receives a deep clone of the current state snapshot
	 * @param debounceOptions - Configuration for debouncing save operations
	 *   Defaults: `{ delay: 0, immediate: false }`. `maxWait` is left unset unless
	 *   provided - debounce-ts requires `maxWait >= delay` and treats `0` as an
	 *   active value, so forcing a `0` default would throw whenever `delay > 0`.
	 *
	 * @throws {Error} Re-throws any errors encountered during debounce function setup
	 *
	 * @example
	 * ```typescript
	 * // Simple localStorage-based state stash
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

		// Create debounced save function if saveCallback is provided
		if (this.#saveCallback) {
			this.#debouncedSave = debounce(async () => {
				// Chain saves to a queue to ensure they complete in order
				this.#saveQueue = this.#saveQueue.then(async () => {
					try {
						if (!this.state) {
							throw new Error('save() was called before load() resolved');
						}

						// Create a snapshot to prevent mutations during async save
						const stateSnapshot = $state.snapshot(this.state) as T;
						await this.#saveCallback!(stateSnapshot);
					} finally {
						// Resolve pending save promise when save completes (success or error)
						if (this.#resolvePendingSave) {
							this.#resolvePendingSave();
							this.#pendingSavePromise = null;
							this.#resolvePendingSave = null;
						}
					}
				});
			}, this.#debounceOptions);
		}
	}

	/**
	 * Loads state data using the configured loadCallback.
	 *
	 * Uses structured cloning to ensure the loaded data is completely independent
	 * from the original source, preventing unintended mutations that could affect
	 * the data source or cause unexpected behavior.
	 *
	 * Handles both objects and arrays intelligently:
	 * - For arrays: Updates in place by clearing and pushing items to preserve references
	 * - For objects: Updates in place using Object.assign to preserve references
	 * - On first load or type change: Replaces state entirely
	 *
	 * After loading completes, `state` will be populated with the loaded data.
	 *
	 * @returns Promise that resolves when loading is complete and state is populated
	 *
	 * @throws {Error} Re-throws any error from the loadCallback
	 *
	 * @example
	 * ```typescript
	 * const stash = new Stash(loadFn, saveFn);
	 * await stash.load(); // Initialise state from storage
	 * console.log(stash.state); // Now contains loaded data
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
			const err = error instanceof Error ? error : new Error(String(error));
			throw new Error(
				'Failed to clone loaded data in load(). This typically happens when loadCallback returns a non-cloneable value',
				{ cause: err }
			);
		}

		// Re-check if destroyed after await to prevent mutation after destruction
		if (this.#destroyed) {
			return;
		}

		if (this.state && Array.isArray(this.state) && Array.isArray(cleanData)) {
			// If state already exists as Array, update in place to preserve references
			this.state.length = 0;
			this.state.push(...cleanData);
		} else if (this.state && !Array.isArray(this.state) && !Array.isArray(cleanData)) {
			// If state already exists as Object, update in place, dropping stale keys
			for (const key of Object.keys(this.state)) {
				if (!Object.prototype.hasOwnProperty.call(cleanData as object, key)) {
					delete (this.state as Record<string, unknown>)[key];
				}
			}
			Object.assign(this.state, cleanData);
		} else {
			// If state is undefined (first load), or type changed, strictly replace it.
			this.state = cleanData;
		}
	};

	/**
	 * Triggers a save operation using the configured saveCallback.
	 *
	 * If debouncing is configured, this will use the debounced version.
	 * If no saveCallback was provided during construction, this method does nothing.
	 *
	 * This method returns a promise that resolves when the save operation completes.
	 * Multiple calls to save() will return the same promise until the save completes.
	 * The actual save operation is debounced and executed asynchronously.
	 * Use {@link flush} to force immediate execution.
	 *
	 * The save operation creates a deep clone of the current state snapshot to
	 * prevent mutations during the asynchronous save process.
	 *
	 * Related methods:
	 * - Use {@link flush} to immediately execute any pending save
	 * - Use {@link cancel} to discard pending saves without persisting
	 *
	 * @throws {Error} Errors from the save callback will surface as unhandled rejections
	 *                unless an onError callback is provided in debounceOptions.
	 *
	 * @example
	 * ```typescript
	 * stash.state.theme = 'dark'; // Modify state
	 * await stash.save(); // Trigger save and wait for completion
	 * ```
	 */
	save = (): Promise<void> => {
		if (this.#destroyed) {
			return Promise.resolve();
		}
		if (this.#debouncedSave) {
			// If no pending promise, create one
			if (!this.#pendingSavePromise) {
				this.#pendingSavePromise = new Promise(resolve => {
					this.#resolvePendingSave = resolve;
				});
			}
			// Call the debounced save
			this.#debouncedSave();
			return this.#pendingSavePromise;
		}
		return Promise.resolve();
	};

	/**
	 * Immediately executes any pending debounced save operation and clears timers.
	 *
	 * Returns a promise that resolves when the save operation completes.
	 * Useful for ensuring state is persisted before critical operations like
	 * page unload, navigation, or application shutdown.
	 * If no save is pending, this method returns a resolved promise immediately.
	 *
	 * @returns Promise that resolves when pending save completes
	 *
	 * @example
	 * ```typescript
	 * window.addEventListener('beforeunload', (e) => {
	 *     e.preventDefault();
	 *     stash.flush().then(() => {
	 *         window.location.href = '/next-page';
	 *     });
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
	 * Cancels any pending debounced save operation and clears timers.
	 *
	 * Useful when you want to discard pending changes without persisting them,
	 * such as when a user clicks "Cancel" or "Discard changes".
	 *
	 * @example
	 * ```typescript
	 * async function discardChanges() {
	 *     stash.cancel();       // Cancel pending save
	 *     await stash.load();   // Reload from storage
	 * }
	 * ```
	 */
	cancel = (): void => {
		if (this.#debouncedSave) {
			this.#debouncedSave.cancel();
		}
	};

	/**
	 * Destroys the Stash instance, cleaning up all resources.
	 *
	 * Cancels any pending save operations, nullifies the debounced save function,
	 * and resets the state to undefined. Call this when the Stash is no longer needed,
	 * such as during component unmounting, to prevent memory leaks.
	 *
	 * After calling destroy(), the Stash should not be used further.
	 *
	 * @example
	 * ```typescript
	 * // In a Svelte component
	 * onDestroy(() => {
	 *     stash.destroy();
	 * });
	 * ```
	 */
	destroy = (): void => {
		this.#destroyed = true;
		this.cancel();
		this.#debouncedSave = null;
		this.state = undefined;
		this.#saveQueue = Promise.resolve();
	};

	/**
	 * Returns a plain, non-reactive snapshot of `state` for serialization.
	 *
	 * Since `state` is implemented as a non-enumerable `$state` accessor, it is
	 * omitted by default from `JSON.stringify()` and object spreads. This method
	 * ensures `JSON.stringify(stash)` reflects the actual managed state rather
	 * than internal bookkeeping fields.
	 *
	 * @example
	 * ```typescript
	 * JSON.stringify(stash); // Serializes stash.state, not internal fields
	 * ```
	 */
	toJSON(): T | undefined {
		return this.state === undefined ? undefined : ($state.snapshot(this.state) as T);
	}
}
