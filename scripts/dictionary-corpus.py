"""Fetch a frozen, reproducible German Wiktionary evaluation corpus (no user data)."""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request
import time

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-artifacts' / 'dictionary-evaluation'
GROUPS = {
    'straightforward': 'Baum Haus Hund Katze schön schnell heute Wasser Brot rot grün klein'.split(),
    'sections': 'mit Band Bank See Leiter Steuer Kiefer Tor der das um zu'.split(),
    'cases': 'ohne helfen wegen auf trotz für bei durch gegen zwischen seit gegenüber'.split(),
    'verbs': 'gehen versprochen sein haben nehmen aufstehen geben ging geholfen werden sehen läuft'.split(),
    'formatting': 'was sich als doch ja es dass ab denn noch nur eben'.split(),
    'missing-and-misleading': 'Akkusativ Dativ Genitiv Kasus Grammatik Flexion Konjugation Infinitiv Partizip Präposition Adverb Pronomen'.split(),
}
OUT.mkdir(parents=True, exist_ok=True)
manifest = []
for group, words in GROUPS.items():
    for index, word in enumerate(words):
        manifest.append({'word': word, 'group': group,
                         'split': 'development' if index < 6 else 'final' if index < 10 else 'reserve',
                         'file': f'{group}-{index+1:02}.json',
                         'sourceUrl': 'https://de.wiktionary.org/wiki/' + urllib.parse.quote(word)})
manifest_path = OUT / 'manifest.json'
if manifest_path.exists() and json.loads(manifest_path.read_text(encoding='utf-8')) != manifest:
    raise RuntimeError('Frozen corpus changed')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

def fetch(item):
    path = OUT / item['file']
    if path.exists():
        return item['word'], 'cached'
    # Reserves are deliberately not fetched/read until needed.
    if item['split'] == 'reserve':
        return item['word'], 'reserved'
    params = urllib.parse.urlencode(dict(action='parse', page=item['word'], prop='text|revid',
                                        format='json', formatversion=2, redirects=1))
    req = urllib.request.Request('https://de.wiktionary.org/w/api.php?' + params,
                                 headers={'User-Agent': 'DubTranscriptLab-PrototypeEvaluation/0.11 (source-comparison)'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 5:
                raise
            time.sleep(min(30, 5 * (attempt + 1)))
    time.sleep(1)
    html = payload.get('parse', {}).get('text', '')
    record = {**item, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'revision': payload.get('parse', {}).get('revid'),
              'title': payload.get('parse', {}).get('title'),
              'sha256': hashlib.sha256(html.encode()).hexdigest(), 'html': html,
              'error': payload.get('error')}
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    return item['word'], 'fetched' if html else 'missing'

with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    for word, status in pool.map(fetch, manifest):
        print(word, status)

# Explicit base page for the known development inflection; not a scored entry.
fetch({'word': 'versprechen', 'group': 'supplement', 'split': 'development',
       'file': 'base-versprechen.json', 'sourceUrl': 'https://de.wiktionary.org/wiki/versprechen'})
