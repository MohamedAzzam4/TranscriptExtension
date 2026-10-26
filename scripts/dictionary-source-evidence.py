"""Independent BeautifulSoup source inventory to assist manual comparisons.

This is evidence, not the production parser and not an automatic quality score.
Sources are frozen API HTML snapshots, German-language boundaries only.
"""
import json
import re
import sys
from pathlib import Path
from bs4 import BeautifulSoup, Tag

folder = Path(__file__).resolve().parents[1] / 'test-artifacts/dictionary-evaluation'
split = sys.argv[1] if len(sys.argv) > 1 else 'development'
extracted = json.loads((folder / f'extracted-{split}.json').read_text(encoding='utf-8'))
report = []
for row in extracted['results']:
    source_file = row.get('baseEvidence', {}).get('file') if row.get('baseEvidence') else row['file']
    source = json.loads((folder / source_file).read_text(encoding='utf-8'))
    soup = BeautifulSoup(source['html'], 'html.parser')
    for element in soup.select('sup,script,style,.mw-editsection,.noprint'):
        element.decompose()
    german = False
    section = ''
    mode = ''
    examples = []
    definitions = []
    for node in soup.find_all(['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'dd', 'li']):
        text = node.get_text(' ', strip=True)
        if node.name == 'h2':
            german = bool(re.search(r'\bDeutsch\b', text))
            section = ''; mode = ''
        if not german:
            continue
        if node.name == 'h3':
            section = text; mode = ''
        elif node.name in ('h4', 'h5', 'h6'):
            mode = text.rstrip(':')
        elif node.name == 'p' and text.endswith(':'):
            mode = text[:-1]
        elif node.name in ('dd', 'li') and mode in ('Beispiele', 'Bedeutungen'):
            if node.find_parent('table'):
                continue
            copy = BeautifulSoup(str(node), 'html.parser')
            top = copy.find(node.name)
            for child in list(top.find_all(['dl', 'ul', 'ol'])):
                child.decompose()
            own = top.get_text(' ', strip=True)
            record = {'section': section, 'text': own}
            (examples if mode == 'Beispiele' else definitions).append(record)
    report.append({'word': row['word'], 'sourceFile': source_file, 'examples': examples,
                   'definitions': definitions, 'outputExamples': row['result']['examples'],
                   'outputSenses': row['result']['senses']})
(folder / f'source-inventory-{split}.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
for row in report:
    print(row['word'], 'source/output examples', len(row['examples']), len(row['outputExamples']))
