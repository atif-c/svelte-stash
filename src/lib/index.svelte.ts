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
 * - `state` is initially `null` until `load()` is called.
 * - After loading, `state` is a `$state` object. Mutate its fields (e.g. `stash.state.theme = 'dark'`)
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
 * const settingsstash = new Stash<UserSettings>(
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
 * await settingsstash.load();
 * ```
 */
export class Stash<T extends object> {
	state = $state<T>();
	#loadCallback: () => T | Promise<T>;
	#saveCallback?: (storage: T) => void | Promise<void>;
	readonly debounceOptions: Readonly<DebounceOptions>;

	/** Debounced version of the save function, created during initialisation */
	private debouncedSave: DebouncedFunction<[]> | null = null;

	/** Flag to track if the stash has been destroyed */
	private destroyed = false;

	/**
	 * Creates a new Stash instance with load/save callbacks and debounce configuration.
	 *
	 * @param loadCallback - Sync or async function that retrieves the initial state object
	 * @param saveCallback - Optional sync or async function to persist state changes
	 *   Receives a deep clone of the current state snapshot
	 * @param debounceOptions - Configuration for debouncing save operations
	 *   Defaults: `{ delay: 0, maxWait: 0, immediate: false }`
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
		this.debounceOptions = {
			delay: debounceOptions?.delay ?? 0,
			maxWait: debounceOptions?.maxWait ?? 0,
			immediate: debounceOptions?.immediate ?? false,
			...(debounceOptions?.onError && { onError: debounceOptions.onError })
		};

		// Create debounced save function if saveCallback is provided
		if (this.#saveCallback) {
			this.debouncedSave = debounce(async () => {
				if (!this.#saveCallback || !this.state) return;

				// Create a snapshot and deep clone to prevent mutations during async save
				const stateSnapshot = structuredClone($state.snapshot(this.state)) as T;
				await this.#saveCallback(stateSnapshot);
			}, this.debounceOptions);
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
		if (this.destroyed) {
			return;
		}
		const loadedData = await this.#loadCallback();
		const cleanData = structuredClone(loadedData);

		if (this.state && Array.isArray(this.state) && Array.isArray(cleanData)) {
			// If state already exists as Array, update in place to preserve references
			this.state.length = 0;
			this.state.push(...cleanData);
		} else if (this.state && !Array.isArray(this.state) && !Array.isArray(cleanData)) {
			// If state already exists as Object, update in place
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
	 * Note: This method returns immediately. The actual save operation is debounced
	 * and executed asynchronously. Use {@link flush} to force immediate execution.
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
	 * stash.save(); // Trigger save (may be debounced)
	 * ```
	 */
	save = (): void => {
		if (this.destroyed) {
			return;
		}
		if (this.debouncedSave) {
			this.debouncedSave();
		}
	};

	/**
	 * Immediately executes any pending debounced save operation and clears timers.
	 *
	 * Useful for ensuring state is persisted before critical operations like
	 * page unload, navigation, or application shutdown.
	 * If no save is pending, this method does nothing.
	 *
	 * @example
	 * ```typescript
	 * window.addEventListener('beforeunload', () => {
	 *     stash.flush();
	 * });
	 * ```
	 */
	flush = (): void => {
		if (this.debouncedSave) {
			this.debouncedSave.flush();
		}
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
		if (this.debouncedSave) {
			this.debouncedSave.cancel();
		}
	};

	/**
	 * Destroys the Stash instance, cleaning up all resources.
	 *
	 * Cancels any pending save operations, nullifies the debounced save function,
	 * and resets the state to null. Call this when the Stash is no longer needed,
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
		this.destroyed = true;
		this.cancel();
		this.debouncedSave = null;
		this.state = undefined;
	};
}
