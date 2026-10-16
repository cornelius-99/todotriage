import type { ComponentChildren } from 'preact';

// Todoist content is lightly formatted markdown. Render links, bold, italics and code; leave the rest as text.
const TOKEN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)/g;

function inline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, linkText, linkUrl, bare, bold, bold2, code, em] = m;
    const k = m.index;
    if (linkUrl) out.push(<a key={k} href={linkUrl} target="_blank" rel="noopener noreferrer">{linkText}</a>);
    else if (bare) out.push(<a key={k} href={bare} target="_blank" rel="noopener noreferrer">{bare.replace(/^https?:\/\/(www\.)?/, '')}</a>);
    else if (bold || bold2) out.push(<strong key={k}>{bold || bold2}</strong>);
    else if (code) out.push(<code key={k}>{code}</code>);
    else if (em) out.push(<em key={k}>{em}</em>);
    last = k + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, multiline }: { text: string; multiline?: boolean }) {
  if (!multiline) return <>{inline(text)}</>;
  return (
    <>
      {text.split('\n').map((line, i) => (
        <p key={i}>{line.trim() ? inline(line) : ' '}</p>
      ))}
    </>
  );
}
