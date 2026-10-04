/**
 * Minimal Markdown → HTML for AI answers (pure module, testable with tsx).
 * EVERYTHING is escaped first: only the tags produced here come out (headings,
 * lists, tables, bold, italic, code, http(s) links). Code blocks, tables with a
 * header row and separator, and one-level bullet or numbered lists with
 * indented continuation lines are supported. No raw HTML, no images, no
 * attributes taken from the text.
 */

function esc(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
	let out = esc(s);
	out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
	out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
	out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
	return out;
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
	return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Number (with €, %, signs): right-aligned cell. */
const NUMERIC = /^[−+-]?\s?[\d\s.,]+\s?(€|%|k€)?$/;

export function mdToHtml(md: string): string {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	let i = 0;
	let para: string[] = [];
	const flush = () => {
		if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
		para = [];
	};
	while (i < lines.length) {
		const line = lines[i]!;
		if (/^```/.test(line.trim())) {
			flush();
			const buf: string[] = [];
			i++;
			while (i < lines.length && !/^```/.test(lines[i]!.trim())) buf.push(lines[i++]!);
			i++;
			out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
			continue;
		}
		if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
			flush();
			const head = cells(line);
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(cells(lines[i++]!));
			const td = (c: string, tag: 'td' | 'th') => `<${tag}${NUMERIC.test(c) && c !== '' ? ' class="num"' : ''}>${inline(c)}</${tag}>`;
			out.push(
				`<div class="md-table"><table><thead><tr>${head.map((c) => td(c, 'th')).join('')}</tr></thead><tbody>${rows
					.map((r) => `<tr>${r.map((c) => td(c, 'td')).join('')}</tr>`)
					.join('')}</tbody></table></div>`
			);
			continue;
		}
		const h = /^(#{1,4})\s+(.*)$/.exec(line);
		if (h) {
			flush();
			const level = Math.min(h[1]!.length + 2, 6);
			out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
			i++;
			continue;
		}
		if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
			flush();
			const ordered = /^\s*\d+[.)]\s+/.test(line);
			const items: string[] = [];
			while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) {
				let item = lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, '');
				i++;
				while (i < lines.length && /^\s{2,}\S/.test(lines[i]!) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) item += ' ' + lines[i++]!.trim();
				items.push(`<li>${inline(item)}</li>`);
			}
			out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
			continue;
		}
		if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
			flush();
			out.push('<hr>');
			i++;
			continue;
		}
		if (line.trim() === '') flush();
		else para.push(line);
		i++;
	}
	flush();
	return out.join('');
}
