import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Stash, type DebounceOptions } from './index.svelte.js';

describe('svelte-stash', () => {
	type StateType = {
		count: number;
		darkMode: boolean;
		theme: {
			colour: string;
		};
	};

	let mockPersistentState: StateType;
	let debounceOptions: Required<Pick<DebounceOptions, 'delay' | 'maxWait' | 'immediate'>>;
	let mockLoadCallback: ReturnType<typeof vi.fn<() => StateType>>;
	let mockSaveCallback: ReturnType<typeof vi.fn<(state: StateType) => void>>;

	beforeEach(() => {
		vi.useFakeTimers();

		mockPersistentState = {
			count: 1,
			darkMode: false,
			theme: { colour: 'orange' }
		};

		debounceOptions = { delay: 500, maxWait: 1000, immediate: false };
		mockLoadCallback = vi.fn(() => mockPersistentState);
		mockSaveCallback = vi.fn((state: StateType): void => {
			mockPersistentState = state;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe('Constructor', () => {
		it('should create instance with load and save callbacks, and debounce options', () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			expect(stash).toBeDefined();
			expect(stash.load).toBeDefined();
			expect(stash.save).toBeDefined();
			expect(stash.state).toBeUndefined();
		});

		it('should create instance without save callback', () => {
			const stash = new Stash<StateType>(mockLoadCallback, undefined, debounceOptions);

			expect(stash).toBeDefined();
			expect(stash.load).toBeDefined();
			expect(stash.save).toBeDefined();
			expect(stash.state).toBeUndefined();
		});

		it('should initialise with default debounce options', () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback);

			expect(stash).toBeDefined();
			expect(stash.load).toBeDefined();
			expect(stash.save).toBeDefined();
			expect(stash.state).toBeUndefined();
		});

		it('should not throw when delay > 0 is provided without maxWait', () => {
			// Regression test: omitting maxWait used to default it to 0, which
			// debounce-ts rejects with `maxWait must be greater than or equal to delay`
			// whenever delay > 0.
			expect(
				() => new Stash<StateType>(mockLoadCallback, mockSaveCallback, { delay: 500 })
			).not.toThrow();
		});

		it('should initialise with onError callback', () => {
			const onError = vi.fn();
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, {
				...debounceOptions,
				onError
			});

			expect(stash).toBeDefined();
			expect(stash.load).toBeDefined();
			expect(stash.save).toBeDefined();
			expect(stash.state).toBeUndefined();
		});
	});

	describe('load()', () => {
		it('should handle sync loadCallback', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(stash.state).toEqual(mockPersistentState);
		});

		it('should handle async loadCallback', async () => {
			const asyncLoadCallback = vi.fn(async () => {
				return mockLoadCallback();
			});

			const stash = new Stash<StateType>(asyncLoadCallback, mockSaveCallback, debounceOptions);
			expect(asyncLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(asyncLoadCallback).toHaveBeenCalledTimes(1);
			expect(stash.state).toEqual(mockPersistentState);
		});

		it('should handle empty object load', async () => {
			const emptyLoadCallback = vi.fn(() => ({}) as StateType);

			const stash = new Stash<StateType>(emptyLoadCallback, mockSaveCallback, debounceOptions);
			expect(emptyLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(emptyLoadCallback).toHaveBeenCalledTimes(1);
			expect(stash.state).toEqual({});
		});

		it('should handle empty array load', async () => {
			const emptyLoadCallback = vi.fn(() => [] as unknown as StateType);

			const stash = new Stash<StateType>(emptyLoadCallback, mockSaveCallback, debounceOptions);
			expect(emptyLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(emptyLoadCallback).toHaveBeenCalledTimes(1);
			expect(stash.state).toEqual([]);
		});

		it('should update persistent object value independently ', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockLoadCallback).toHaveBeenCalledTimes(0);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('orange');
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('orange');
			expect(stash.state.theme.colour).toBe('orange');

			mockPersistentState.theme.colour = 'blue';
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('blue');
			expect(stash.state.theme.colour).toBe('orange');

			await stash.load();
			expect(mockLoadCallback).toHaveBeenCalledTimes(2);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('blue');
			expect(stash.state.theme.colour).toBe('blue');
		});

		it('should update state value object independently', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockLoadCallback).toHaveBeenCalledTimes(0);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('orange');
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('orange');
			expect(stash.state.theme.colour).toBe('orange');

			stash.state.theme.colour = 'blue';
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(mockPersistentState.theme.colour).toBe('orange');
			expect(stash.state.theme.colour).toBe('blue');

			stash.save();
			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);
			expect(mockPersistentState.theme.colour).toBe('blue');
			expect(stash.state.theme.colour).toBe('blue');
		});

		it('should remove keys from state that no longer exist in loaded data', async () => {
			type PartialState = { a: number; b?: number };
			let source: PartialState = { a: 1, b: 2 };
			const loadPartialCallback = vi.fn(() => source);
			const savePartialCallback = vi.fn();

			const stash = new Stash<PartialState>(
				loadPartialCallback,
				savePartialCallback,
				debounceOptions
			);

			await stash.load();
			expect(stash.state).toEqual({ a: 1, b: 2 });

			source = { a: 1 };
			await stash.load();

			expect(stash.state).toEqual({ a: 1 });
			expect('b' in stash.state).toBe(false);
			expect(stash.state.b).toBeUndefined();
		});

		it('should update persistent array value independently', async () => {
			type ArrayState = string[];
			const arrayPersistenceState = ['first', 'second'];
			const loadArrayCallback = vi.fn(() => arrayPersistenceState);
			const saveArrayCallback = vi.fn();

			const stash = new Stash<ArrayState>(loadArrayCallback, saveArrayCallback, debounceOptions);
			expect(loadArrayCallback).toHaveBeenCalledTimes(0);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(2);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(loadArrayCallback).toHaveBeenCalledTimes(1);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(2);
			expect(stash.state).toHaveLength(2);

			arrayPersistenceState.push('third');
			expect(loadArrayCallback).toHaveBeenCalledTimes(1);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(3);
			expect(stash.state).toHaveLength(2);

			await stash.load();
			expect(loadArrayCallback).toHaveBeenCalledTimes(2);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(3);
			expect(stash.state).toHaveLength(3);
		});

		it('should update state array value independently', async () => {
			type ArrayState = string[];
			const arrayPersistenceState = ['first', 'second'];
			const loadArrayCallback = vi.fn(() => arrayPersistenceState);
			const saveArrayCallback = vi.fn((state: ArrayState): void => {
				arrayPersistenceState.length = 0;
				arrayPersistenceState.push(...state);
			});

			const stash = new Stash<ArrayState>(loadArrayCallback, saveArrayCallback, debounceOptions);
			expect(loadArrayCallback).toHaveBeenCalledTimes(0);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(2);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(loadArrayCallback).toHaveBeenCalledTimes(1);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(2);
			expect(stash.state).toHaveLength(2);

			stash.state.push('third');
			expect(loadArrayCallback).toHaveBeenCalledTimes(1);
			expect(saveArrayCallback).toHaveBeenCalledTimes(0);
			expect(arrayPersistenceState).toHaveLength(2);
			expect(stash.state).toHaveLength(3);

			stash.save();
			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(loadArrayCallback).toHaveBeenCalledTimes(1);
			expect(saveArrayCallback).toHaveBeenCalledTimes(1);
			expect(arrayPersistenceState).toHaveLength(3);
			expect(stash.state).toHaveLength(3);
		});

		it('should throw when sync loadCallback throws', async () => {
			const failingLoadCallback = vi.fn(() => {
				throw new Error('Sync load failed');
			});

			const stash = new Stash<StateType>(failingLoadCallback, mockSaveCallback, debounceOptions);
			expect(failingLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			expect(stash.load()).rejects.toThrow('Sync load failed');
		});

		it('should throw when async loadCallback throws', async () => {
			const asyncFailingLoadCallback = vi.fn(async () => {
				throw new Error('Async load failed');
			});

			const stash = new Stash<StateType>(
				asyncFailingLoadCallback,
				mockSaveCallback,
				debounceOptions
			);
			expect(asyncFailingLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			await expect(stash.load()).rejects.toThrow('Async load failed');
		});
	});

	describe('save()', () => {
		it('should return a Promise', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();
			const savePromise = stash.save();
			expect(savePromise).toBeInstanceOf(Promise);
		});

		it('should resolve promise when save completes', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();

			const savePromise = stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			await Promise.resolve();

			await expect(savePromise).resolves.toBeUndefined();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should return same promise for multiple save calls', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();

			const promise1 = stash.save();
			const promise2 = stash.save();
			const promise3 = stash.save();

			expect(promise1).toBe(promise2);
			expect(promise2).toBe(promise3);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			await expect(promise1).resolves.toBeUndefined();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			await expect(promise1).resolves.toBeUndefined();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should handle sync saveCallback', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);
		});

		it('should handle async saveCallback', async () => {
			const asyncSaveCallback = vi.fn(async (state: StateType) => {});

			const stash = new Stash<StateType>(mockLoadCallback, asyncSaveCallback, debounceOptions);
			expect(asyncSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(asyncSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(asyncSaveCallback).toHaveBeenCalledTimes(1);
			expect(asyncSaveCallback).toHaveBeenNthCalledWith(1, stash.state);
		});

		it('should debounce save calls', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			stash.save();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should not call save when no saveCallback provided', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, undefined, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should create snapshot of state for save', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);
		});

		it('should work with immediate debounce option', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, {
				...debounceOptions,
				immediate: true
			});
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should throw when sync saveCallback throws', async () => {
			const onError = vi.fn();
			const failingSaveCallback = vi.fn(() => {
				throw new Error('Sync save failed');
			});

			const stash = new Stash<StateType>(mockLoadCallback, failingSaveCallback, {
				...debounceOptions,
				onError
			});

			await stash.load();
			stash.save();
			expect(failingSaveCallback).toHaveBeenCalledTimes(0);
			expect(onError).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(failingSaveCallback).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error));
		});

		it('should throw when async saveCallback throws', async () => {
			const onError = vi.fn();
			const asyncFailingSaveCallback = vi.fn(async () => {
				throw new Error('Async save failed');
			});

			const stash = new Stash<StateType>(mockLoadCallback, asyncFailingSaveCallback, {
				...debounceOptions,
				onError
			});

			await stash.load();
			stash.save();
			expect(asyncFailingSaveCallback).toHaveBeenCalledTimes(0);
			expect(onError).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(asyncFailingSaveCallback).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error));
		});

		it('should surface an error via onError when save() is called before load() resolves', async () => {
			const onError = vi.fn();
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, {
				...debounceOptions,
				onError
			});

			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(onError).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error));
			expect(onError.mock.calls[0][0].message).toMatch('save() was called before load() resolved');
		});

		it('should still persist when load() resolves before the debounce delay elapses', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			stash.save();
			await stash.load();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);
		});
	});

	describe('flush()', () => {
		it('should return a Promise', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();

			stash.save();
			const flushPromise = stash.flush();
			expect(flushPromise).toBeInstanceOf(Promise);
		});

		it('should resolve promise when flush completes', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();

			stash.save();
			const flushPromise = stash.flush();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);

			await expect(flushPromise).resolves.toBeUndefined();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should return resolved promise when no save pending', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();

			const flushPromise = stash.flush();
			expect(flushPromise).toBeInstanceOf(Promise);
			await expect(flushPromise).resolves.toBeUndefined();
		});

		it('should immediately execute pending save', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.flush();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should immediately execute multiple pending saves', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			stash.save();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.flush();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should do nothing when no save pending', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.flush();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should do nothing when no saveCallback provided', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, undefined, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.flush();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should surface an error via onError when flush() is called before load() resolves', async () => {
			const onError = vi.fn();
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, {
				...debounceOptions,
				onError
			});

			stash.save();
			stash.flush();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
			expect(onError).toHaveBeenNthCalledWith(1, expect.any(Error));
			expect(onError.mock.calls[0][0].message).toMatch(/save\(\) was called before load\(\)/);
		});
	});

	describe('cancel()', () => {
		it('should cancel pending save', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
			expect(mockSaveCallback).toHaveBeenNthCalledWith(1, stash.state);

			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);

			stash.cancel();
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(1);
		});

		it('should cancel multiple pending saves', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			stash.save();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.cancel();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should do nothing when no save pending', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.cancel();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});
	});

	describe('destroy()', () => {
		it('should prevent load after destroy', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockLoadCallback).toHaveBeenCalledTimes(0);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(stash.state).not.toBeUndefined();

			stash.destroy();
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(mockLoadCallback).toHaveBeenCalledTimes(1);
			expect(stash.state).toBeUndefined();
		});

		it('should prevent save after destroy', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			stash.destroy();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should cancel pending save on destroy', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.destroy();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should cancel multiple pending saves on destroy', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await stash.load();
			stash.save();
			stash.save();
			stash.save();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			stash.destroy();
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);

			await vi.advanceTimersByTimeAsync(debounceOptions.delay);
			expect(mockSaveCallback).toHaveBeenCalledTimes(0);
		});

		it('should set state to undefined after destroy', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);
			expect(stash.state).toBeUndefined();

			await stash.load();
			expect(stash.state).not.toBeUndefined();

			stash.destroy();
			expect(stash.state).toBeUndefined();
		});
	});

	describe('encapsulation', () => {
		it('should not expose internal fields as own properties', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();

			expect(Object.keys(stash)).not.toContain('destroyed');
			expect(Object.keys(stash)).not.toContain('debouncedSave');
			expect(Object.keys(stash)).not.toContain('pendingSavePromise');
			expect(Object.keys(stash)).not.toContain('resolvePendingSave');
			expect(Object.keys(stash)).not.toContain('saveQueue');
			expect(Object.keys(stash)).not.toContain('debounceOptions');

			expect((stash as unknown as Record<string, unknown>)['destroyed']).toBeUndefined();
			expect((stash as unknown as Record<string, unknown>)['debouncedSave']).toBeUndefined();
			expect((stash as unknown as Record<string, unknown>)['debounceOptions']).toBeUndefined();
		});
	});

	describe('toJSON()', () => {
		it('should return undefined before load()', () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			expect(JSON.stringify(stash)).toBe(undefined);
			expect(stash.toJSON()).toBeUndefined();
		});

		it('should serialize the loaded state, not internal fields', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();

			expect(stash.toJSON()).toEqual(mockPersistentState);
			expect(JSON.parse(JSON.stringify(stash))).toEqual(mockPersistentState);
		});

		it('should return undefined after destroy()', async () => {
			const stash = new Stash<StateType>(mockLoadCallback, mockSaveCallback, debounceOptions);

			await stash.load();
			stash.destroy();

			expect(stash.toJSON()).toBeUndefined();
		});
	});
});
