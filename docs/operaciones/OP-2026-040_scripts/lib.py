import json,re,urllib.request
ROOT='C:/Users/luigg/Desktop/construacero/'
CFG={'prod':(ROOT+'.env','oyfyuszgjwcepjpngclv'),'staging':(ROOT+'construacero-staging/.env','spupqgkdsgohxxfoxydl')}
def tok(f):
    for l in open(f,encoding='utf-8'):
        if l.startswith('SUPABASE_ACCESS_TOKEN='): return l.split('=',1)[1].strip().strip('"')
WRITE=re.compile(r'\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy)\b',re.I)
def q(env,sql):
    f,ref=CFG[env]; body={'query':sql}
    if env=='prod':
        if WRITE.search(sql): raise SystemExit('BLOQUEADO: produccion es solo lectura')
        body['read_only']=True
    req=urllib.request.Request(f'https://api.supabase.com/v1/projects/{ref}/database/query',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+tok(f),'Content-Type':'application/json','User-Agent':'op040-script'},method='POST')
    try: r=json.loads(urllib.request.urlopen(req,timeout=120).read().decode('utf-8'))
    except urllib.error.HTTPError as e: raise SystemExit(f'ERROR {env}: {e.read().decode()}')
    return r
arr=lambda v:"array["+",".join("'%s'"%x for x in v)+"]::uuid[]"
