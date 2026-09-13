#!/usr/bin/env python3
"""Export repository documentation into an existing GitHub wiki checkout."""
import argparse
from pathlib import Path
import re
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
REPO = 'https://github.com/Alshival-Ai/neural-labs'


def export(destination=None):
    sources = sorted((ROOT / 'wiki').rglob('*.md'))
    sources += [ROOT / name for name in ('CHANGELOG.md', 'roadmap.md', 'tracker.md')]
    pages = {}
    for source in sources:
        relative = source.relative_to(ROOT)
        if relative == Path('wiki/README.md'):
            name = 'Home'
        elif relative.parts[0] == 'wiki':
            name = '-'.join(relative.with_suffix('').parts[1:])
        else:
            name = source.stem
        pages[source.resolve()] = name
    if len(set(pages.values())) != len(pages):
        raise ValueError('Duplicate wiki page names')
    output = {}
    for source, name in pages.items():
        def rewrite(match):
            target = match.group(2)
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or target.startswith('#'):
                return match.group(0)
            resolved = (source.parent / unquote(parsed.path)).resolve()
            if resolved in pages:
                url = REPO + '/wiki/' + quote(pages[resolved])
            else:
                if not resolved.exists():
                    raise ValueError(f'Broken link in {source.relative_to(ROOT)}: {target}')
                relative = resolved.relative_to(ROOT)
                kind = 'tree' if resolved.is_dir() else 'blob'
                url = f'{REPO}/{kind}/main/{quote(relative.as_posix())}'
            if parsed.query:
                url += '?' + parsed.query
            if parsed.fragment:
                url += '#' + parsed.fragment
            return match.group(1) + url + match.group(3)
        output[name + '.md'] = re.sub(r'(\]\()([^\s)]+)(\))', rewrite, source.read_text())
    # Keep the browsable guide directory and GitHub sidebar in sync. Its links
    # have already passed through the same validation and rewrite as every page.
    output['_Sidebar.md'] = output['navigation.md']
    output['_Footer.md'] = f'Maintained in [`wiki/`]({REPO}/tree/main/wiki). To update these pages, edit the source documentation and follow the [publishing guide]({REPO}/wiki/wiki-publishing).\n'
    if destination is not None:
        destination.mkdir(parents=True, exist_ok=True)
        for filename, content in output.items():
            (destination / filename).write_text(content)
        print(f'Exported {len(pages)} documentation pages and navigation to {destination}')
    else:
        print(f'Validated {len(pages)} documentation pages and navigation; no files written')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', nargs='?', type=Path, help='Local checkout of neural-labs.wiki.git')
    parser.add_argument('--check', action='store_true', help='Validate the export without writing files')
    args = parser.parse_args()
    if args.check == (args.destination is not None):
        parser.error('provide either a destination or --check')
    export(args.destination)
