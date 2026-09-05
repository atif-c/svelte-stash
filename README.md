# svelte-stash

[![GitHub Repo](https://img.shields.io/badge/GitHub-atif--c%2Fsvelte--stash-blue?logo=github)](https://github.com/atif-c/svelte-stash)
[![npm Package](https://img.shields.io/npm/v/svelte-stash?logo=npm)](https://npmjs.com/package/svelte-stash)

A lightweight, generic state management class for Svelte 5 projects that **bridges in-memory reactive state with persistent storage**. Uses Svelte 5 `$state` runes, letting you sync with your chosen storage backend (localStorage, APIs, databases, etc.).

> **Requires Svelte 5.0.0 or higher** - This package uses Svelte 5's `$state` runes and will not work with Svelte 4 or earlier versions.

## Features

- Extends Svelte 5's `$state` rune for automatic reactivity
- Configurable Debouncing
- Works with any storage backend (localStorage, database, API endpoints, etc.)
- Full TypeScript support with generic type constraints
- Prevents reference mutations between state and storage

## Installation

```bash
npm install svelte-stash
```

The package has one peer dependency: **Svelte 5**

## Usage

### Basic setup

````typescript
import { Stash } from 'svelte-stash';

interface UserSettings {
	theme: 'light' | 'dark';
	language: string;
	notifications: boolean;
}

// Create a stash that syncs in-memory state with localStorage
const settings = new Stash<UserSettings>(
	// Load callback - retrieves state from storage
	async () => {
		const saved = localStorage.getItem('userSettings');
		return saved
			? JSON.parse(saved)
			: {
					theme: 'dark',
					language: 'en',
					notifications: true
				};
	},
	// Save function - persist state changes
	async data => {
		localStorage.setItem('userSettings', JSON.stringify(data));
	},
	// Debounce options - optimize storage writes
	{ delay: 500, maxWait: 2000 }
);

// Initialise: Load from persistent storage into reactive memory
await settings.load();

// Export state
export { settings };
```

### In Svelte components

```svelte
<script lang="ts">
	import { settings } from '$lib/stores/settings';

	// The state is reactive in-memory - changes instantly update the UI
	let { state } = settings;

	function toggleTheme() {
		state!.theme = state!.theme === 'light' ? 'dark' : 'light';
		settings.save();
	}
</script>

<button on:click={toggleTheme}>
	Current theme: {state?.theme}
	<!-- Updates instantly -->
</button>

<label>
	<input type="checkbox" bind:checked={state?.notifications} />
	Enable notifications
</label>
````

**How it works:**

1. **Load**: Storage → Memory (on initialization)
2. **Mutate**: Direct in-memory changes (instant UI updates)
3. **Sync**: Memory → Storage via `save()` (debounced)

### Custom debouncing

```typescript
const stash = new Stash(loadFn, saveFn, {
	delay: 300, // Wait 300ms after last change
	maxWait: 2000, // Force save after 2 seconds maximum
	immediate: true // Save immediately on first change
});
```

### Multiple stashs

```typescript
// Separate stashs for different concerns
const userSettings = new Stash(loadUserSettings, saveUserSettings);
const appCache = new Stash(loadCache, saveCache, { delay: 100 });
const gameState = new Stash(loadGame, saveGame, { immediate: true });
```

### Force save before page close

```typescript
const stash = new Stash(loadFn, saveFn, { delay: 500 });

// Ensure pending saves complete before page closes
window.addEventListener('beforeunload', async e => {
	// Prevent default unload to allow time for save to complete
	e.preventDefault();

	// Wait for save to complete, then allow navigation
	await stash.flush();
	e.returnValue = true;
});
```

### Discard pending changes

```typescript
async function discardChanges() {
	stash.cancel(); // Cancel pending save
	await stash.load(); // Reload original state from storage
}
```

### Error handling

```typescript
const stash = new Stash(loadFn, saveFn, {
	delay: 500,
	onError: error => {
		console.error('Failed to save state:', error);
		showNotification('Auto-save failed. Your changes may not be saved.');
	}
});
```

By default, save errors surface as unhandled rejections. Use `onError` to handle them explicitly. Load errors are thrown and should be caught with try-catch.

## API

### `new Stash<T>(loadCallback, saveCallback?, debounceOptions?)`

**Parameters:**

- `loadCallback` — Function to load initial state data (sync or async). Should return the complete state object.
- `saveCallback` _(optional)_ — Function to persist state changes. Receives a deep clone of current state (sync or async).
- `debounceOptions` _(optional)_ — Configuration for save debouncing:

| Option      | Type                       | Default | Description                                |
| ----------- | -------------------------- | ------- | ------------------------------------------ |
| `delay`     | `number`                   | `0`     | Milliseconds to wait after last change     |
| `maxWait`   | `number`                   | —       | Maximum milliseconds before forcing a save |
| `immediate` | `boolean`                  | `false` | Execute save immediately on first change   |
| `onError`   | `(error: unknown) => void` | —       | Callback for handling save errors          |

> `maxWait`, if provided, must be greater than or equal to `delay` (enforced by the underlying `debounce-ts` dependency).

### Properties

- **`state`** — The reactive state object (Svelte 5 `$state`). Type is `T | undefined` — `undefined` until `load()` is called.

### Methods

- **`load()`** — Loads state from persistent storage into reactive memory
- **`save()`** — Manually triggers a sync from memory to persistent storage. Returns a `Promise<void>` that resolves when the save completes.
- **`flush()`** — Immediately executes any pending debounced save and clears timers. Returns a `Promise<void>` that resolves when the save completes.
- **`cancel()`** — Cancels any pending debounced save without persisting

## Important Notes

### Type constraints

- State type `T` must be structured-cloneable/serializable
- Functions, DOM nodes, and certain class instances will not work properly
- Use plain objects, arrays, primitives, and serializable data only

### Reactivity best practices

- Mutate state fields directly: `stash.state!.theme = 'dark'` (use `!` after `load()` or `?.` for safety)
- Avoid replacing the entire state object
- Use `$state.snapshot(stash.state)` to get a non-reactive copy for external use (check for `undefined` first)

## License

MIT
