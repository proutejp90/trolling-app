import sys, glob, re, collections, statistics as st, datetime as dt
import netCDF4, numpy as np
D=sys.argv[1]
temp=collections.defaultdict(dict)   # hour -> {depth_m: degF}
wdir={}; wspd={}
for f in sorted(glob.glob(D+'/*.nc')):
    m=re.search(r'45024_([a-z-]+)_(\d{3})-(\d)_',f); kind=m.group(1); depth=int(m.group(2))+int(m.group(3))/10
    d=netCDF4.Dataset(f); t=np.array(d['time'][:],dtype='float64')
    var=[k for k,vv in d.variables.items() if len(vv.shape)==2][0]
    v=np.ma.filled(d[var][0,:].astype('float64'),np.nan)
    hrs=(t//3600).astype('int64')
    for h in np.unique(hrs):
        x=v[hrs==h]; x=x[~np.isnan(x)]
        if not len(x): continue
        if kind=='sea-water-temperature':
            k=float(np.mean(x)); 
            if 270<k<305: temp[int(h)][depth]=(k-273.15)*9/5+32
        elif kind=='wind-from-direction':
            r=np.deg2rad(x); wdir[int(h)]=float(np.rad2deg(np.arctan2(np.sin(r).mean(),np.cos(r).mean()))%360)
        else: wspd[int(h)]=float(np.mean(x))
print('hours with temp',len(temp),'wind',len(wdir))
FT=3.28084
def iso(profile, target=55.0):
    """Depth (ft) where water first cools to target going down. None if never within the string."""
    ds=sorted(profile); 
    if len(ds)<6: return 'short'
    if profile[ds[0]]<=target: return 0.0
    for a,b in zip(ds,ds[1:]):
        ta,tb=profile[a],profile[b]
        if ta>target>=tb: return (a+(ta-target)/(ta-tb)*(b-a))*FT
    return None   # warmer than target to the bottom of the string
def sector(deg):
    return 'N' if (deg>=315 or deg<45) else 'E' if deg<135 else 'S' if deg<225 else 'W'
rows=[]
for h in sorted(temp):
    d=dt.datetime.fromtimestamp(h*3600,dt.timezone.utc)
    if d.month not in (7,8): continue
    win=[sector(wdir[x]) for x in range(h-48,h) if x in wdir]
    if len(win)<40: continue
    c=collections.Counter(win); ne=c['N']+c['E']
    z=iso(temp[h]); 
    if z=='short': continue
    bottom=max(temp[h])*FT
    z0=iso(temp.get(h-48,{})) 
    rows.append(dict(h=h,y=d.year,ne=ne*48/len(win),n=c['N']*48/len(win),e=c['E']*48/len(win),s=c['S']*48/len(win),w=c['W']*48/len(win),z=z,bottom=bottom,z0=z0,bt=temp[h][max(temp[h])],st=temp[h][min(temp[h])]))
print('Jul-Aug hours analysed',len(rows),'by year',sorted(collections.Counter(r['y'] for r in rows).items()))
def summarize(name, sel):
    n=len(sel)
    if not n: print(name,'none'); return
    capped=[r for r in sel if r['z'] is None]
    zs=sorted((r['z'] if r['z'] is not None else r['bottom']) for r in sel)   # capped at string bottom
    q=lambda p: zs[int(p*(n-1))]
    print(f"{name:34s} n={n:5d}  55F depth ft: p25={q(.25):5.1f} median={q(.5):5.1f} p75={q(.75):5.1f}  warm-to-bottom={len(capped)/n:4.0%}  at-surface={sum(1 for z in zs if z==0)/n:4.0%}  bottom temp median={st.median(r['bt'] for r in sel):.1f}F surface={st.median(r['st'] for r in sel):.1f}F")
up=[r for r in rows if r['ne']>=24]; no=[r for r in rows if r['ne']<24]
summarize('N or E wind >=24 of last 48 h',up); summarize('otherwise',no)
for k,lab in (('n','north'),('e','east'),('s','south'),('w','west')):
    summarize(f'{lab} wind >=24 of last 48 h',[r for r in rows if r[k]>=24])
# change over the 48 h window, where both ends are measurable (uncapped or capped at bottom)
def val(r,key,b): 
    return b if r[key] is None else r[key]
for name,sel in (('N or E >=24h',up),('otherwise',no),('north >=24h',[r for r in rows if r['n']>=24]),('south >=24h',[r for r in rows if r['s']>=24])):
    ch=[val(r,'z',r['bottom'])-val(r,'z0',r['bottom']) for r in sel if r['z0']!='short']
    if ch: 
        ch.sort(); print(f"48 h change in 55F depth, {name:14s} n={len(ch):5d} median={st.median(ch):+6.1f} ft  p25={ch[int(.25*(len(ch)-1))]:+6.1f} p75={ch[int(.75*(len(ch)-1))]:+6.1f}  shallower>5ft={sum(1 for c in ch if c<-5)/len(ch):4.0%} deeper>5ft={sum(1 for c in ch if c>5)/len(ch):4.0%}")
# per year consistency
for y in sorted({r['y'] for r in rows}):
    a=[val(r,'z',r['bottom']) for r in up if r['y']==y]; b=[val(r,'z',r['bottom']) for r in no if r['y']==y]
    if a and b: print(y,'median 55F depth: upwelling wind',round(st.median(a),1),f'(n={len(a)})','other',round(st.median(b),1),f'(n={len(b)})','diff',round(st.median(b)-st.median(a),1))
print('string depths m',sorted({d for r in list(temp.values())[:2000] for d in r}))
