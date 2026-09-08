export function titleFromMarkdown(markdown: string): string {
  return (
    markdown
      .split('\n')
      .find((line) => line.trim())
      ?.replace(/^#+\s*/, '')
      .slice(0, 90) || 'Untitled'
  );
}
