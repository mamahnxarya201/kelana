<script lang="ts">
  import { onMount } from 'svelte';
  import { loadAsset } from './lib/storage';
  let { id, alt }: { id: string; alt: string } = $props();
  let url = $state('');
  let error = $state('');
  onMount(() => {
    let alive = true;
    loadAsset(id)
      .then((blob) => {
        if (alive) url = URL.createObjectURL(blob);
      })
      .catch((e) => (error = e.message));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  });
</script>

{#if url}<img src={url} {alt} draggable="false" />{:else}<p class="muted">
    {error || 'Loading image…'}
  </p>{/if}
