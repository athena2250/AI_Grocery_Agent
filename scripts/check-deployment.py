#!/usr/bin/env python3
"""Read-only checks against a deployed API; never creates accounts or modifies data."""
import argparse
import json
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument('api_url', help='HTTPS API origin')
parser.add_argument('--contact-email', default='rithvika.tiruveedhula51@gmail.com')
parser.add_argument('--web-origin', help='Hosted browser origin to check against CORS')
args = parser.parse_args()
base = args.api_url.rstrip('/')
if not base.startswith('https://'):
    parser.error('Use the production HTTPS API URL')
with urlopen(base + '/healthz', timeout=30) as response:
    assert json.load(response) == {'ok': True}, 'API/database health failed'
with urlopen(base + '/privacy', timeout=30) as response:
    page = response.read().decode()
    assert args.contact_email in page and '[CONTACT EMAIL]' not in page, 'Privacy contact missing'
if args.web_origin:
    request = Request(base + '/sync/grocery', method='OPTIONS', headers={
        'Origin': args.web_origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
    })
    with urlopen(request, timeout=30) as response:
        assert response.headers.get('Access-Control-Allow-Origin') == args.web_origin, 'Browser CORS failed'
print('PASS: HTTPS, API/database health, privacy contact' + (', browser CORS' if args.web_origin else ''))
