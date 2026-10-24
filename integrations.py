"""Explicit Google Maps intents and a fixed external-application allowlist."""
import re
import unicodedata
from urllib.parse import urlencode, urlsplit, parse_qs

MAPS_HOME = 'https://www.google.com/maps/'
CURRENT_LOCATION = {'', '現在地', '今いる場所', '現在位置', 'ここ'}


def clean_place(value):
    if value is None:value=''
    if not isinstance(value,str):raise ValueError('Place must be text')
    value = value.strip()
    if len(value) > 200 or any(ord(c) < 32 for c in value):
        raise ValueError('場所は200文字以内で入力してね。')
    return value


def driving_url(destination, origin=''):
    destination, origin = clean_place(destination), clean_place(origin)
    if not destination:
        raise ValueError('目的地を入力してね。')
    params = {'api':'1', 'destination':destination, 'travelmode':'driving', 'dir_action':'navigate'}
    if origin not in CURRENT_LOCATION:
        params['origin'] = origin
    url='https://www.google.com/maps/dir/?' + urlencode(params)
    if len(url)>2048:raise ValueError('Googleマップに渡す場所が長すぎるよ。')
    return url


def validate_maps_url(url):
    u = urlsplit(url)
    if u.scheme != 'https' or u.netloc != 'www.google.com' or u.fragment:
        return False
    if u.path == '/maps/' and not u.query:
        return True
    params = parse_qs(u.query)
    return (u.path == '/maps/dir/' and set(params) <= {'api','destination','origin','travelmode','dir_action'}
            and params.get('api') == ['1'] and params.get('travelmode') == ['driving']
            and params.get('dir_action') == ['navigate'] and len(params.get('destination',[])) == 1
            and bool(params['destination'][0].strip()))


def parse_maps_command(text):
    text = unicodedata.normalize('NFKC', text).strip().rstrip('。!！?？ ')
    text = re.sub(r'^(?:よりそい|アスター|(?i:aster))[、,\s]*', '', text)
    if re.search(r'ナビしない|案内しない|開かない|やめて|キャンセル', text):
        return None
    if re.fullmatch(r'(?:Google\s*マップ|グーグルマップ)(?:を)?開いて(?:ください)?',text,re.I):
        return {'kind':'home'}
    text = re.sub(r'^(?:Google\s*マップ|グーグルマップ)(?:で|を使って)[、,\s]*','',text,flags=re.I)
    endings = r'(?:ナビ(?:を開始)?して|案内して|車のナビを開いて|車の経路を開いて|経路を表示して|ナビをお願い)(?:ください|くれる)?'
    match = re.fullmatch(r'車で(.+?)(?:まで|へ|に)(?:の)?' + endings,text)
    if not match:
        match = re.fullmatch(r'(.+?)(?:まで|へ|に)車(?:で|の)' + endings,text)
    if not match and not re.match(r'^(?:電車|徒歩|歩いて|自転車)',text):
        match=re.fullmatch(r'(.+?)(?:まで|へ|に)(?:の)?'+endings,text)
    if match:
        route = match.group(1).strip()
        if route.find('から')>0:
            origin,destination=route.split('から',1)
        else:
            origin,destination='',route
        return {'kind':'driving', 'origin':clean_place(origin), 'destination':clean_place(destination)}
    if re.fullmatch(r'(?:車のナビ|車でナビ|車の経路)(?:を)?(?:開いて|開始して|お願い)(?:ください)?',text):
        return {'kind':'needs_destination'}
    return None


def parse_destination_reply(text):
    text=unicodedata.normalize('NFKC',text).strip().rstrip('。!！?？ ')
    explicit=re.match(r'^(?:目的地|行き先)(?:は|を|:)[、,\s]*(.+)$',text)
    place=explicit.group(1) if explicit else text
    place=re.sub(r'(?:にして|でお願い|です|だよ)$','',place).strip()
    if explicit or re.fullmatch(r'.+(?:駅|空港|公園|病院|市役所|店|城|タワー|センター|水族館)',place):
        return clean_place(place) or None
    return None
