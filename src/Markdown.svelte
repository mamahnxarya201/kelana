<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  let { text }: { text: string } = $props();
  const html = $derived(
    DOMPurify.sanitize(marked.parse(text, { async: false }) as string, {
      FORBID_TAGS: ['img', 'iframe', 'video', 'audio'],
      FORBID_ATTR: ['style'],
    }),
  );
</script>

<div class="markdown">{@html html}</div>
