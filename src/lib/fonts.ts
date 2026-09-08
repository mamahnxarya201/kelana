import type { FontId } from './model';

export type FontOption = {
  id: FontId;
  label: string;
  family: string;
  kind: 'Sans serif' | 'Serif' | 'Academic';
};

export const fontOptions: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter',
    family: "'Inter Variable', Inter, 'Segoe UI', sans-serif",
    kind: 'Sans serif',
  },
  {
    id: 'source-sans',
    label: 'Source Sans 3',
    family: "'Source Sans 3 Variable', 'Segoe UI', sans-serif",
    kind: 'Sans serif',
  },
  {
    id: 'source-serif',
    label: 'Source Serif 4',
    family: "'Source Serif 4 Variable', Georgia, serif",
    kind: 'Serif',
  },
  {
    id: 'lora',
    label: 'Lora',
    family: "'Lora Variable', Georgia, serif",
    kind: 'Serif',
  },
  {
    id: 'stix-two',
    label: 'STIX Two Text',
    family: "'STIX Two Text Variable', 'Times New Roman', serif",
    kind: 'Academic',
  },
  {
    id: 'libertinus',
    label: 'Libertinus Serif',
    family: "'Libertinus Serif', 'Times New Roman', serif",
    kind: 'Academic',
  },
];

export function fontFamily(id: FontId | undefined): string {
  return fontOptions.find((font) => font.id === id)?.family ?? fontOptions[0].family;
}
