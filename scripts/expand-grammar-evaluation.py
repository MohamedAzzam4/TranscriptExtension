"""Freeze and retrieve new public confirmation cases, never alter old reserves."""
import datetime
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-artifacts' / 'grammar-expanded'
OUT.mkdir(parents=True, exist_ok=True)
GROUPS = {
    'case-rules': 'statt während innerhalb außerhalb gemäß entgegen dank samt nebst entlang'.split(),
    'verb-base': 'gefahren gesessen gegessen getrunken geschrieben gelesen brachte dachte wusste gewesen'.split(),
    'conjugations': 'machen sagen sehen sprechen schlafen laufen dürfen müssen wollen tun'.split(),
}
BASES = dict(zip(GROUPS['verb-base'], 'fahren sitzen essen trinken schreiben lesen bringen denken wissen sein'.split()))
manifest = [{'word': word, 'group': group, 'file': f'{group}-{index+1:02}.json',
             'sourceUrl': 'https://de.wiktionary.org/wiki/' + urllib.parse.quote(word),
             'expectedBase': BASES.get(word)}
            for group, words in GROUPS.items() for index, word in enumerate(words)]
target = OUT / 'manifest.json'
if target.exists() and json.loads(target.read_text(encoding='utf-8')) != manifest:
    raise RuntimeError('Frozen confirmation list changed')
target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
def fetch(item):
    path = OUT / item['file']
    if path.exists():
        print(item['word'], 'cached', flush=True)
        return
    query = urllib.parse.urlencode(dict(action='parse', page=item['word'], prop='text|revid',
                                       format='json', formatversion=2, redirects=1))
    request = urllib.request.Request('https://de.wiktionary.org/w/api.php?' + query,
                                    headers={'User-Agent': 'DubTranscriptLab-PrototypeEvaluation/0.11 (source-comparison)'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 5:
                raise
            time.sleep(min(30, 5 * (attempt + 1)))
    html = payload.get('parse', {}).get('text', '')
    record = {**item, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'title': payload.get('parse', {}).get('title'), 'revision': payload.get('parse', {}).get('revid'),
              'sha256': hashlib.sha256(html.encode()).hexdigest(), 'html': html, 'error': payload.get('error')}
    path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    print(item['word'], 'fetched' if html else 'missing', flush=True)
    time.sleep(1.5)
for item in manifest:
    fetch(item)
for index, word in enumerate(dict.fromkeys(BASES.values())):
    fetch({'word': word, 'group': 'supplementary-base', 'file': f'base-{index+1:02}.json',
           'sourceUrl': 'https://de.wiktionary.org/wiki/' + urllib.parse.quote(word)})
