// Todoist's named project/label colors.
const COLORS: Record<string, string> = {
  berry_red: '#b8255f',
  red: '#db4035',
  orange: '#ff9933',
  yellow: '#fad000',
  olive_green: '#afb83b',
  lime_green: '#7ecc49',
  green: '#299438',
  mint_green: '#6accbc',
  teal: '#158fad',
  sky_blue: '#14aaf5',
  light_blue: '#96c3eb',
  blue: '#4073ff',
  grape: '#884dff',
  violet: '#af38eb',
  lavender: '#eb96eb',
  magenta: '#e05194',
  salmon: '#ff8d85',
  charcoal: '#808080',
  grey: '#b8b8b8',
  taupe: '#ccac93',
};

export const todoistColor = (name: string | undefined) => (name && COLORS[name]) || COLORS.charcoal;

/** UI priority (P1 = most urgent) from API priority (4 = most urgent). */
export const uiPriority = (api: number) => 5 - api;
export const apiPriority = (ui: number) => (5 - ui) as 1 | 2 | 3 | 4;

/** CSS colour for each UI priority, indexed by P1–P4. */
export const PRIORITY_COLOR = ['', 'var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--muted)'];
