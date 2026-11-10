# Face generator: 8 backgrounds x 8 eyes x 8 mouths x 8 extras, ink-outlined sticker style
INK='#111111'
BG_COLORS=['#FFD60A','#00EC97','#7CC6FF','#FF9EC7','#FF8A3D',None,None,'#B9A6FF']
BG_NAMES=['Highlighter','NEAR green','Sky','Bubblegum','Sunset','Batik kawung','Parang stripe','Lilac']
EYE_NAMES=['Dots','Laser','Shades','Sleepy','Wide','Wink','Knocked out','Determined']
MOUTH_NAMES=['Grin','Flat','Oh','Smirk','Tongue','Teeth','Frown','Cat']
EXTRA_NAMES=['None','CEO tie','Party hat','Top hat','Headband','Monocle','Sweat drop','Peci']

def bg(i, uid):
    if i==5:  # kawung: four-petal ovals
        pat=f'<pattern id="kw{uid}" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#F3D9A4"></rect><ellipse cx="20" cy="9" rx="6" ry="9" fill="none" stroke="{INK}" stroke-width="2"></ellipse><ellipse cx="20" cy="31" rx="6" ry="9" fill="none" stroke="{INK}" stroke-width="2"></ellipse><ellipse cx="9" cy="20" rx="9" ry="6" fill="none" stroke="{INK}" stroke-width="2"></ellipse><ellipse cx="31" cy="20" rx="9" ry="6" fill="none" stroke="{INK}" stroke-width="2"></ellipse><circle cx="20" cy="20" r="2.5" fill="{INK}"></circle></pattern>'
        return f'<defs>{pat}</defs><rect x="4" y="4" width="192" height="192" rx="24" fill="url(#kw{uid})" stroke="{INK}" stroke-width="6"></rect>'
    if i==6:
        pat=f'<pattern id="pr{uid}" width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="28" height="28" fill="#FF8A3D"></rect><rect width="12" height="28" fill="#FFF6E0"></rect><rect x="12" width="3" height="28" fill="{INK}"></rect></pattern>'
        return f'<defs>{pat}</defs><rect x="4" y="4" width="192" height="192" rx="24" fill="url(#pr{uid})" stroke="{INK}" stroke-width="6"></rect>'
    return f'<rect x="4" y="4" width="192" height="192" rx="24" fill="{BG_COLORS[i]}" stroke="{INK}" stroke-width="6"></rect>'

def eyes(i):
    s=f'stroke="{INK}" stroke-width="6" stroke-linecap="round" fill="none"'
    if i==0: return f'<circle cx="78" cy="98" r="8" fill="{INK}"></circle><circle cx="122" cy="98" r="8" fill="{INK}"></circle>'
    if i==1: return f'<path d="M78 98 L196 84" stroke="#D7141A" stroke-width="7"></path><path d="M122 98 L196 108" stroke="#D7141A" stroke-width="7"></path><circle cx="78" cy="98" r="10" fill="#D7141A" stroke="{INK}" stroke-width="4"></circle><circle cx="122" cy="98" r="10" fill="#D7141A" stroke="{INK}" stroke-width="4"></circle>'
    if i==2: return f'<path d="M56 88 H144 V100 Q144 114 128 114 H114 Q104 114 104 102 H96 Q96 114 86 114 H72 Q56 114 56 100 Z" fill="{INK}"></path><path d="M66 94 H80" stroke="#FFFFFF" stroke-width="3"></path>'
    if i==3: return f'<path d="M66 100 Q78 92 90 100" {s}></path><path d="M110 100 Q122 92 134 100" {s}></path>'
    if i==4: return f'<circle cx="78" cy="96" r="15" fill="#FFFFFF" stroke="{INK}" stroke-width="5"></circle><circle cx="122" cy="96" r="15" fill="#FFFFFF" stroke="{INK}" stroke-width="5"></circle><circle cx="82" cy="98" r="6" fill="{INK}"></circle><circle cx="126" cy="98" r="6" fill="{INK}"></circle>'
    if i==5: return f'<circle cx="78" cy="98" r="8" fill="{INK}"></circle><path d="M110 98 H134" {s}></path>'
    if i==6: return f'<path d="M70 90 L86 106 M86 90 L70 106" {s}></path><path d="M114 90 L130 106 M130 90 L114 106" {s}></path>'
    return f'<path d="M64 82 L90 90" {s}></path><path d="M136 82 L110 90" {s}></path><circle cx="78" cy="100" r="7" fill="{INK}"></circle><circle cx="122" cy="100" r="7" fill="{INK}"></circle>'

def mouth(i):
    s=f'stroke="{INK}" stroke-width="6" stroke-linecap="round" fill="none"'
    if i==0: return f'<path d="M72 128 Q100 156 128 128" {s}></path>'
    if i==1: return f'<path d="M78 136 H122" {s}></path>'
    if i==2: return f'<ellipse cx="100" cy="138" rx="10" ry="13" fill="{INK}"></ellipse>'
    if i==3: return f'<path d="M80 138 Q106 146 124 126" {s}></path>'
    if i==4: return f'<path d="M74 128 Q100 152 126 128 Z" fill="{INK}"></path><path d="M92 138 Q100 160 110 138" fill="#FF6B8B" stroke="{INK}" stroke-width="4"></path>'
    if i==5: return f'<rect x="74" y="124" width="52" height="22" rx="8" fill="#FFFFFF" stroke="{INK}" stroke-width="5"></rect><path d="M87 124 V146 M100 124 V146 M113 124 V146" stroke="{INK}" stroke-width="3"></path>'
    if i==6: return f'<path d="M76 144 Q100 122 124 144" {s}></path>'
    return f'<path d="M80 132 Q90 144 100 132 Q110 144 120 132" {s}></path>'

def extra(i):
    if i==1: return f'<path d="M92 172 L108 172 L114 196 L100 200 L86 196 Z" fill="#D7141A" stroke="{INK}" stroke-width="4"></path><path d="M90 164 H110 L106 174 H94 Z" fill="#D7141A" stroke="{INK}" stroke-width="4"></path>'
    if i==2: return f'<path d="M100 8 L124 52 H76 Z" fill="#FFD60A" stroke="{INK}" stroke-width="5"></path><circle cx="100" cy="10" r="7" fill="#D7141A" stroke="{INK}" stroke-width="4"></circle><path d="M86 40 L94 30 M106 40 L114 30" stroke="#D7141A" stroke-width="4"></path>'
    if i==3: return f'<rect x="70" y="12" width="60" height="38" rx="4" fill="{INK}"></rect><rect x="54" y="46" width="92" height="10" rx="4" fill="{INK}"></rect><rect x="70" y="36" width="60" height="7" fill="#D7141A"></rect>'
    if i==4: return f'<path d="M34 76 Q100 52 166 76" stroke="#D7141A" stroke-width="12" fill="none"></path><path d="M164 72 L186 62 M164 76 L186 86" stroke="#D7141A" stroke-width="6" stroke-linecap="round"></path>'
    if i==5: return f'<circle cx="122" cy="96" r="20" fill="none" stroke="#C9A227" stroke-width="5"></circle><path d="M140 106 Q150 140 142 170" stroke="#C9A227" stroke-width="3" fill="none"></path>'
    if i==6: return f'<path d="M150 62 Q160 78 150 86 Q140 78 150 62 Z" fill="#7CC6FF" stroke="{INK}" stroke-width="4"></path>'
    if i==7: return f'<path d="M58 54 Q60 24 100 24 Q140 24 142 54 Z" fill="{INK}"></path><path d="M64 46 H136" stroke="#3A3A3A" stroke-width="3"></path>'
    return ''

def face(b,e,m,x,size=200,uid='a',label=None):
    head=f'<circle cx="100" cy="108" r="66" fill="#FFF6E0" stroke="{INK}" stroke-width="6"></circle>'
    lab=label or f'Coin face: {BG_NAMES[b]}, {EYE_NAMES[e]} eyes, {MOUTH_NAMES[m]} mouth, {EXTRA_NAMES[x]}'
    body=bg(b,uid)+head+mouth(m)+eyes(e)+extra(x)
    return f'<svg viewBox="0 0 200 200" width="{size}" height="{size}" role="img" aria-label="{lab}" style="display:block;max-width:100%;height:auto">{body}</svg>'

def face_no(b,e,m,x): return b*512+e*64+m*8+x+1
