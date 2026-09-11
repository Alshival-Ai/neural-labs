#!/usr/bin/env python3
"""Export repository documentation into an existing GitHub wiki checkout."""
import argparse
from pathlib import Path
import re
from urllib.parse import quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
REPO = 'https://github.com/Alshival-Ai/neural-labs'


def export(destination):
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
    navigation = ['# Neural Labs', '', f'[Home]({REPO}/wiki) · [Source repository]({REPO})', '']
    for heading, names in [
        ('User guides', ['shared-workspace', 'passkeys', 'neura', 'team-chats', 'files', 'terminal', 'vscode', 'automations', 'skills', 'desktop-state']),
        ('Administration', ['container-deployment', 'desktop-settings', 'authentication', 'entra-app-setup', 'backup-restore', 'openclaw-upgrades', 'workspace-provider-mcp']),
    ]:
        navigation += [f'## {heading}', '']
        for name in names:
            title = output[name + '.md'].splitlines()[0].lstrip('# ')
            navigation.append(f'- [{title}]({REPO}/wiki/{name})')
        navigation.append('')
    output['_Sidebar.md'] = '\n'.join(navigation)
    output['_Footer.md'] = f'Maintained in [`wiki/`]({REPO}/tree/main/wiki). To update these pages, edit the source documentation and follow the [publishing guide]({REPO}/wiki/wiki-publishing).\n'
    destination.mkdir(parents=True, exist_ok=True)
    for filename, content in output.items():
        (destination / filename).write_text(content)
    print(f'Exported {len(pages)} documentation pages and navigation to {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, help='Local checkout of neural-labs.wiki.git')
    export(parser.parse_args().destination)
