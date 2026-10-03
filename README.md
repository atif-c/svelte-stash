# svelte-stash

[![GitHub Repo](https://img.shields.io/badge/GitHub-atif--c%2Fsvelte--stash-blue?logo=github)](https://github.com/atif-c/svelte-stash)
[![npm Package](https://img.shields.io/npm/v/svelte-stash?logo=npm)](https://npmjs.com/package/svelte-stash)

A lightweight state manager for Svelte 5. It keeps in-memory state in sync with a storage backend (localStorage, API, database).

> **Requires Svelte 5** - Uses the `$state` rune. Does not work with Svelte 4 or earlier.

## Features

- Uses the Svelte 5 `$state` rune for reactivity
- Debounces saves with configurable timing
- Works with any storage backend (localStorage, database, API)
- Types state through generics
- Clones data between state and storage to block shared references

## Installation

```bash
npm install svelte-stash
```

The package needs one peer dependency: **Svelte 5**

## Usage

### Basic setup

````typescript
import { Stash } from 'svelte-stash';

interface UserSettings {
	theme: 'light' | 'dark';
	language: string;
	notifications: boolean;
}

// Syncs in-memory state with localStorage
const settings = new Stash<UserSettings>(
	// Load callback: reads state from storage
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
	// Save callback: writes state to storage
	async data => {
		localStorage.setItem('userSettings', JSON.stringify(data));
	},
	// Debounce options: limits storage writes
	{ delay: 500, maxWait: 2000 }
);

// Initialise: loads storage into state
await settings.load();

export { settings };
```

### In Svelte components

```svelte
<script lang="ts">
	import { settings } from '$lib/stores/settings';

	// Edits to state update the UI at once
	let { state } = settings;

	function toggleTheme() {
		state!.theme = state!.theme === 'light' ? 'dark' : 'light';
		settings.save();
	}
</script>

<button on:click={toggleTheme}>
	Current theme: {state?.theme}
</button>

<label>
	<input type="checkbox" bind:checked={state?.notifications} />
	Enable notifications
</label>
````

**How it works:**

1. **Load**: storage → state (on start)
2. **Mutate**: edit state directly (UI updates at once)
3. **Sync**: state → storage through `save()` (debounced)

### Custom debounce

```typescript
const stash = new Stash(loadFn, saveFn, {
	delay: 300, // Wait 300ms after last change
	maxWait: 2000, // Force save after 2 seconds maximum
	immediate: true // Save immediately on first change
});
```

### Multiple stashes

```typescript
// One stash per concern
const userSettings = new Stash(loadUserSettings, saveUserSettings);
const appCache = new Stash(loadCache, saveCache, { delay: 100 });
const gameState = new Stash(loadGame, saveGame, { immediate: true });
```

### Save before page close

```typescript
const stash = new Stash(loadFn, saveFn, { delay: 500 });

// Caution: the browser can close before async saves finish.
window.addEventListener('beforeunload', async e => {
	e.preventDefault();
	await stash.flush();
	e.returnValue = true;
});
```

### Discard pending changes

```typescript
async function discardChanges() {
	stash.cancel();
	await stash.load();
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

Without `onError`, save errors surface as unhandled rejections. Pass `onError` to handle save errors. Wrap `load()` in try-catch: load errors throw.

## API

### `new Stash<T>(loadCallback, saveCallback?, debounceOptions?)`

**Parameters:**

- `loadCallback` — Returns the full state object. Runs sync or async.
- `saveCallback` _(optional)_ — Persists state changes. Receives a snapshot of state. Runs sync or async.
- `debounceOptions` _(optional)_ — Debounce config for saves:

| Option      | Type                       | Default | Description                                |
| ----------- | -------------------------- | ------- | ------------------------------------------ |
| `delay`     | `number`                   | `0`     | Milliseconds to wait after last change     |
| `maxWait`   | `number`                   | —       | Maximum milliseconds before forcing a save |
| `immediate` | `boolean`                  | `false` | Execute save immediately on first change   |
| `onError`   | `(error: unknown) => void` | —       | Callback for handling save errors          |

> `maxWait` must be at least `delay`. The `debounce-ts` dependency enforces this.

### Properties

- **`state`** — Reactive state (`$state`). Type: `T | undefined`. Stays `undefined` until `load()` runs.

### Methods

- **`load()`** — Loads storage into state
- **`save()`** — Saves state to storage (debounced). Returns a `Promise<void>` for completion.
- **`flush()`** — Runs any pending save at once and clears timers. Returns a `Promise<void>` for completion.
- **`cancel()`** — Drops any pending save without persisting
- **`destroy()`** — Cancels pending saves and resets state to `undefined`. Do not reuse the stash after this call.
- **`toJSON()`** — Returns a plain snapshot of `state` for `JSON.stringify`. Returns `undefined` before `load()`.

## Important Notes

### Type constraints

- Type `T` must be structured-cloneable
- Functions, DOM nodes and some class instances throw on clone
- Use plain objects and arrays with serializable data

### Reactivity best practices

- Edit fields directly: `settings.state!.theme = 'dark'`. Use `!` after `load()`, or `?.`.
- Do not replace the whole state object
- Check for `undefined` first. Read outside Svelte through `$state.snapshot(settings.state)`.

## License

MIT
