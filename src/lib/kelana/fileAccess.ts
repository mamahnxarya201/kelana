/**
 * The only module that talks about file delivery (pickers, downloads). This is
 * the seam the future desktop wrapper replaces/extends — no other module may
 * mention file pickers or downloads.
 */

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

/** Structural type for the feature-detected File System Access API. */
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

/** Anchor-blob download: works everywhere, no user-facing location choice. */
export function downloadKelana(bytes: ArrayBuffer, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Save through the platform file picker when the browser offers one
 * (feature-detected), falling back to a download. User cancel is reported,
 * never thrown.
 */
export async function saveKelanaWithPicker(
  bytes: ArrayBuffer,
  filename: string,
): Promise<SaveOutcome> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') {
    downloadKelana(bytes, filename);
    return 'downloaded';
  }
  let handle: Awaited<ReturnType<SavePicker>>;
  try {
    handle = await picker.call(window, {
      suggestedName: filename,
      types: [{ description: 'Kelana board', accept: { 'application/octet-stream': ['.kelana'] } }],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    downloadKelana(bytes, filename);
    return 'downloaded';
  }
  const writable = await handle.createWritable();
  await writable.write(new Blob([bytes], { type: 'application/octet-stream' }));
  await writable.close();
  return 'saved';
}
