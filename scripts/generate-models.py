"""Solarbloom original model kit. Python 3 stdlib; reproducible, no downloaded art.
Rounded ceramic shells, brass fittings, glass tanks and curved botanical meshes.
Named pivots are animated by the game. Regenerate: python3 scripts/generate-models.py
"""
import math, json, struct
from pathlib import Path
S,C,PI=math.sin,math.cos,math.pi
OUT=Path(__file__).resolve().parents[1]/'public/models'
COLORS={'ivory':'f8f1da','cream':'d6cdb2','gold':'d5a446','dark':'163d40','blue':'275a9b','grid':'88b8df','water':'56d8ed','glass':'b0edf1','leaf':'8fca48','stem':'42744a','pink':'ef8fb6','purple':'b694e1','white':'fff9e9','yellow':'ffdc68','soil':'5e5540','copper':'ba7855','mint':'7caa99'}
class Model:
 def __init__(self):
  self.nodes=[]; self.parts={}; self.data=bytearray(); self.views=[]; self.acc=[]; self.meshes=[]; self.mats=[]
  for name,h in COLORS.items():
   rgb=[(int(h[i:i+2],16)/255)**2.2 for i in (0,2,4)]
   m={'name':name,'pbrMetallicRoughness':{'baseColorFactor':rgb+[.23 if name=='glass' else 1],'metallicFactor':.65 if name in ('gold','copper') else .05,'roughnessFactor':.22 if name in ('glass','water','dark','gold','blue') else .48}}
   if name=='glass':m.update(alphaMode='BLEND',doubleSided=True)
   if name=='water':m['emissiveFactor']=[v*.35 for v in rgb]
   self.mats.append(m)
 def node(self,name,parent=None,pos=(0,0,0)):
  i=len(self.nodes);self.nodes.append({'name':name,'translation':list(pos)})
  if parent is not None:self.nodes[parent].setdefault('children',[]).append(i)
  return i
 def part(self,node,col,p,n,idx):
  a,b,c=self.parts.setdefault((node,col),([],[],[]));o=len(a)//3;a.extend(p);b.extend(n);c.extend(i+o for i in idx)
 def surface(self,node,col,fn,nu=24,nv=12,pos=(0,0,0),scale=(1,1,1),rot=0):
  pts=[];idx=[]
  for j in range(nv+1):
   for i in range(nu+1):
    x,y,z=fn(i/nu,j/nv);x,y,z=x*scale[0],y*scale[1],z*scale[2]
    pts.extend([pos[0]+x*C(rot)+z*S(rot),pos[1]+y,pos[2]-x*S(rot)+z*C(rot)])
  for j in range(nv):
   for i in range(nu):
    a=j*(nu+1)+i;b=a+nu+1;idx.extend([a,b,a+1,a+1,b,b+1])
  normals=[0.]*len(pts)
  for a,b,c in zip(idx[::3],idx[1::3],idx[2::3]):
   u=[pts[b*3+k]-pts[a*3+k] for k in range(3)];v=[pts[c*3+k]-pts[a*3+k] for k in range(3)]
   n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
   for t in (a,b,c):
    for k in range(3):normals[t*3+k]+=n[k]
  for i in range(0,len(normals),3):
   l=math.sqrt(sum(n*n for n in normals[i:i+3])) or 1
   normals[i:i+3]=[n/l for n in normals[i:i+3]]
  self.part(node,col,pts,normals,idx)
 def orb(self,node,col,pos,scale,box=False):
  power=.26 if box else 1
  def q(v):return math.copysign(abs(v)**power,v)
  self.surface(node,col,lambda u,v:(q(S(PI*v))*q(C(u*2*PI))*.5,q(C(PI*v))*.5,-q(S(PI*v))*q(S(u*2*PI))*.5),24,12,pos,scale)
 def lathe(self,node,col,profile,pos=(0,0,0),segments=32):
  def f(u,v):
   ix=min(len(profile)-2,int(v*(len(profile)-1)));t=v*(len(profile)-1)-ix
   r,y=[profile[ix][i]*(1-t)+profile[ix+1][i]*t for i in (0,1)]
   return (r*C(u*2*PI),y,r*S(u*2*PI))
  self.surface(node,col,f,segments,len(profile)-1,pos)
 def ring(self,node,col,pos,r=.3,t=.018):
  self.surface(node,col,lambda u,v:((r+t*C(2*PI*v))*C(2*PI*u),t*S(2*PI*v),(r+t*C(2*PI*v))*S(2*PI*u)),32,8,pos)
 def leaf(self,node,col,pos,size=.3,rot=0):
  # Closed curved almond, narrow at both ends with a raised central vein.
  self.surface(node,col,lambda u,v:(size*v,size*.18*S(PI*v)+size*.09*S(2*PI*u)*S(PI*v),size*.28*C(2*PI*u)*S(PI*v)),10,10,pos,rot=rot)
 def flower(self,node,pos,col='pink',size=.14):
  x,y,z=pos
  self.lathe(node,'stem',[(0,0),(.009,0),(.009,y), (0,y)],(x,0,z),8)
  for i in range(6):self.leaf(node,col,pos,size,i*PI/3)
  self.orb(node,'yellow',(x,y+.02,z),(.08,.055,.08))
  self.leaf(node,'leaf',(x,y*.45,z),size*1.1,1.1)
 def tube(self,node,col,points,r=.02):
  def fn(u,v):
   ix=min(len(points)-2,int(v*(len(points)-1)));t=v*(len(points)-1)-ix
   a,b=points[ix],points[ix+1];center=[a[k]*(1-t)+b[k]*t for k in range(3)]
   tangent=[b[k]-a[k] for k in range(3)];length=math.sqrt(sum(x*x for x in tangent)) or 1;tangent=[x/length for x in tangent]
   ref=[0,0,1] if abs(tangent[2])<.9 else [0,1,0]
   normal=[tangent[1]*ref[2]-tangent[2]*ref[1],tangent[2]*ref[0]-tangent[0]*ref[2],tangent[0]*ref[1]-tangent[1]*ref[0]]
   l=math.sqrt(sum(x*x for x in normal)) or 1;normal=[x/l for x in normal]
   binormal=[tangent[1]*normal[2]-tangent[2]*normal[1],tangent[2]*normal[0]-tangent[0]*normal[2],tangent[0]*normal[1]-tangent[1]*normal[0]]
   return tuple(center[k]+r*(normal[k]*C(2*PI*u)-binormal[k]*S(2*PI*u)) for k in range(3))
  self.surface(node,col,fn,12,(len(points)-1)*3)
 def access(self,values,kind,component=5126):
  while len(self.data)%4:self.data.append(0)
  start=len(self.data);self.data.extend(struct.pack('<'+('f' if component==5126 else 'I')*len(values),*values));view=len(self.views)
  self.views.append({'buffer':0,'byteOffset':start,'byteLength':len(self.data)-start})
  n={'SCALAR':1,'VEC3':3}[kind];a={'bufferView':view,'componentType':component,'count':len(values)//n,'type':kind}
  if component==5126:a.update(min=[min(values[i::n]) for i in range(n)],max=[max(values[i::n]) for i in range(n)])
  self.acc.append(a);return len(self.acc)-1
 def save(self,name):
  for ni in range(len(self.nodes)):
   prim=[]
   for (node,col),(p,n,idx) in self.parts.items():
    if node!=ni:continue
    prim.append({'attributes':{'POSITION':self.access(p,'VEC3'),'NORMAL':self.access(n,'VEC3')},'indices':self.access(idx,'SCALAR',5125),'material':list(COLORS).index(col)})
   if prim:self.nodes[ni]['mesh']=len(self.meshes);self.meshes.append({'primitives':prim})
  doc={'asset':{'version':'2.0','generator':'Solarbloom botanical model kit'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':self.nodes,'meshes':self.meshes,'materials':self.mats,'buffers':[{'byteLength':len(self.data)}],'bufferViews':self.views,'accessors':self.acc}
  j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);self.data.extend(b'\0'*((-len(self.data))%4))
  result=struct.pack('<III',0x46546c67,2,28+len(j)+len(self.data))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(self.data),0x004e4942)+self.data
  OUT.mkdir(exist_ok=True);(OUT/(name+'.glb')).write_bytes(result);print(name,len(result))

def base(m,r,radius=.35):
 m.lathe(r,'ivory',[(0,0),(radius*.85,0),(radius,.04),(radius,.1),(radius*.88,.15),(0,.15)])
 m.ring(r,'gold',(0,.075,0),radius+.002,.012)
def lamp(m,r,pos):
 l=m.node('status-light',r,pos);m.orb(l,'water',(0,0,0),(1,1,1));m.nodes[l]['scale']=[.06]*3

m=Model();r=m.node('solar');base(m,r)
m.lathe(r,'gold',[(0,.12),(.07,.12),(.07,.4),(0,.4)])
p=m.node('panel-pivot',r,(0,.48,0))
m.orb(p,'ivory',(0,0,0),(.94,.09,.73),True)
m.orb(p,'blue',(0,.045,0),(.85,.035,.64),True)
for x in range(6):
 for z in range(4):
  m.orb(p,'blue',(-.35+x*.14,.071,-.24+z*.16),(.127,.01,.145),True)
  m.orb(p,'grid',(-.35+x*.14,.078,-.24+z*.16),(.005,.002,.135))
for x in range(7):m.orb(p,'grid',(-.42+x*.14,.075,0),(.005,.004,.63))
for z in range(5):m.orb(p,'grid',(0,.075,-.32+z*.16),(.84,.004,.005))
m.orb(p,'gold',(0,.01,-.365),(.88,.035,.028),True);lamp(m,r,(.24,.16,.16));
m.orb(r,'mint',(0,.21,-.19),(.32,.18,.2),True)
m.tube(r,'copper',[(.11,.16,.12),(.17,.2,.16),(.18,.3,.12),(.1,.38,0)],.022)
m.orb(p,'dark',(0,-.055,0),(.32,.08,.42),True)
for i in range(5):m.orb(r,'dark',(-.1+i*.05,.23,-.294),(.018,.08,.008),True)
m.save('solar')

m=Model();r=m.node('condenser');base(m,r,.36)
m.lathe(r,'ivory',[(0,.14),(.25,.14),(.27,.18),(.27,.43),(.24,.49),(0,.49)])
for y in (.5,.95):
 m.lathe(r,'ivory',[(0,y-.035),(.28,y-.035),(.3,y),(.28,y+.035),(0,y+.035)])
 m.ring(r,'gold',(0,y+.025,0),.275,.012)
m.lathe(r,'glass',[(.245,.52),(.245,.93)])
for a in range(4):
 x,z=.255*C(a*PI/2),.255*S(a*PI/2)
 m.lathe(r,'gold',[(0,.51),(.016,.51),(.016,.94),(0,.94)],(x,0,z),12)
m.lathe(r,'dark',[(0,.99),(.08,.99),(.08,1.01),(0,1.01)])
water=m.node('water-orb',r,(0,.7,0));m.orb(water,'water',(0,0,0),(1,1,1));m.nodes[water]['scale']=[.32]*3
b=m.node('bubbles',r)
for i in range(7):m.orb(b,'water',(.12*S(i*2),.57+i*.048,.12*C(i*2)),(.035,.055,.035))
m.orb(r,'dark',(0,.31,.262),(.19,.18,.025),True);lamp(m,r,(0,.32,.29))
m.ring(r,'gold',(0,1.07,0),.13,.018);
m.tube(r,'copper',[(.21,.25,0),(.37,.25,0),(.4,.31,0),(.4,.75,0),(.36,.81,0),(.24,.81,0)],.027)
m.tube(r,'water',[(-.23,.32,0),(-.38,.32,0),(-.42,.27,0),(-.42,.13,0),(-.48,.1,.1)],.034)
for i in range(5):m.orb(r,'dark',(-.105+i*.05,.23,-.262),(.02,.1,.012),True)
# Turbine spindle inside the transparent tank; its rotor follows the bubbles pivot.
m.lathe(r,'gold',[(0,.52),(.018,.52),(.018,.94),(0,.94)],segments=12)
for i in range(3):m.leaf(b,'mint',(0,.68,0),.18,i*2*PI/3)
m.save('condenser')

m=Model();r=m.node('pollinator');base(m,r,.46)
m.lathe(r,'ivory',[(.34,.12),(.37,.12),(.43,.32),(.43,.36),(.38,.37),(.34,.12)])
m.lathe(r,'soil',[(0,.325),(.39,.325),(.39,.33),(0,.33)])
for i in range(9):
 a=i*2.4;rad=.27*math.sqrt(i/9);p=m.node('flower-'+str(i),r,(rad*C(a),.33,rad*S(a)))
 m.flower(p,(0,.23+(i%3)*.09,0),['pink','white','purple'][i%3],.13)
 for j in range(2):m.leaf(p,'leaf',(0,.04,0),.22,j*2.6+i)
m.save('pollinator')

m=Model();r=m.node('droneHub');base(m,r,.85)
m.lathe(r,'ivory',[(.57,.12),(.65,.12),(.7,.22),(.65,.3),(.57,.3),(.57,.12)])
m.lathe(r,'dark',[(0,.16),(.56,.16),(.56,.18),(0,.18)])
ring=m.node('dock-ring',r,(0,.25,0));m.ring(ring,'water',(0,0,0),.58,.017)
for i in range(4):
 a=i*PI/2;m.orb(ring,'gold',(.58*C(a),0,.58*S(a)),(.08,.05,.08))
m.orb(r,'ivory',(-.55,.51,-.45),(.38,.68,.35),True);m.orb(r,'dark',(-.55,.57,-.26),(.25,.18,.035),True)
m.lathe(r,'gold',[(0,.8),(.015,.8),(.015,1.1),(0,1.1)],(-.55,0,-.45),12)
lamp(m,r,(-.55,1.12,-.45))
for x in (-.65,.65):
 for i in range(3):m.leaf(r,'leaf',(x,.2,.5),.27,i*2)

for sign in (-1,1):
 m.orb(r,'mint',(sign*.72,.28,0),(.2,.24,.56),True)
 for i in range(5):m.orb(r,'dark',(sign*.825,.29,-.18+i*.09),(.012,.11,.035),True)
 m.tube(r,'copper',[(sign*.55,.28,-.25),(sign*.68,.42,-.35),(sign*.68,.5,-.5)],.026)
 m.orb(r,'gold',(sign*.44,.24,.4),(.14,.035,.15),True)
m.save('droneHub')

m=Model();r=m.node('drone')
m.orb(r,'ivory',(0,0,0),(.46,.34,.42));m.ring(r,'gold',(0,-.025,0),.216,.014)
m.orb(r,'dark',(0,.015,.177),(.33,.18,.09),True)
for x,name in ((-.075,'eye-left'),(.075,'eye-right')):
 e=m.node(name,r,(x,.03,.222));m.orb(e,'water',(0,0,0),(1,1,1));m.nodes[e]['scale']=[.04,.05,.02]
for sign,name in ((-1,'wing-left'),(1,'wing-right')):
 n=m.node(name,r,(sign*.19,.07,0));m.leaf(n,'leaf',(0,0,0),.32,0 if sign>0 else PI)
 m.leaf(n,'yellow',(0,.008,0),.24,0 if sign>0 else PI)
m.lathe(r,'gold',[(0,.14),(.012,.14),(.012,.25),(0,.25)],(0,0,-.05),12)
m.leaf(r,'leaf',(0,.25,-.05),.16,-.4)
m.orb(r,'water',(0,-.18,0),(.1,.045,.1));m.save('drone')

# Mother tree: a living machine in a ceramic energy collector.
m=Model();r=m.node('motherTree');base(m,r,.83)
m.lathe(r,'soil',[(0,.15),(.7,.15),(.7,.17),(0,.17)])
m.surface(r,'soil',lambda u,v:(.13*(1-v*.65)*C(u*2*PI)+.08*S(v*5),.15+v*1.35,.13*(1-v*.65)*S(u*2*PI)),24,16)
for i in range(5):
 a=i*2*PI/5;m.tube(r,'copper',[(.65*C(a),.16,.65*S(a)),(.4*C(a),.22,.4*S(a)),(.13*C(a),.65,.13*S(a))],.025)
c=m.node('canopy',r,(0,1.5,0))
for i in range(15):
 a=i*2.4;radius=.6*math.sqrt(i/15);x,z=radius*C(a),radius*S(a);y=.4*(1-i/15)
 m.orb(c,['stem','leaf','mint'][i%3],(x,y,z),(.57,.46,.57))
 for j in range(3):m.leaf(c,'leaf',(x,y+.2,z),.3,j*2+i)
for i in range(9):
 a=i*2.4;m.flower(c,(.65*C(a),.1+(i%3)*.1,.65*S(a)),['pink','white','yellow'][i%3],.11)
m.save('motherTree')

# Bloom Relay: copper signal coil, ceramic tower, three rotating botanical vanes.
m=Model();r=m.node('relay');base(m,r,.32)
m.lathe(r,'ivory',[(0,.14),(.18,.14),(.12,.28),(.1,1.05),(.16,1.1),(0,1.1)])
for i in range(7):m.ring(r,'copper',(0,.35+i*.075,0),.115,.015)
m.orb(r,'dark',(0,.23,.16),(.16,.1,.035),True)
v=m.node('relay-vanes',r,(0,1.1,0))
for i in range(3):m.leaf(v,'mint',(0,0,0),.38,i*2*PI/3)
m.ring(r,'gold',(0,1.12,0),.33,.018)
lamp(m,r,(0,1.19,0));m.save('relay')

# Reservoir garden: a shaped basin, exposed intake and floating lilies.
m=Model();r=m.node('reservoirGarden');base(m,r,.44)
m.lathe(r,'ivory',[(.3,.12),(.36,.12),(.43,.23),(.43,.31),(.39,.34),(.35,.3),(.3,.12)])
m.ring(r,'gold',(0,.32,0),.4,.012)
m.tube(r,'copper',[(.35,.12,0),(.49,.18,0),(.49,.43,0),(.42,.49,0),(.3,.49,0)],.03)
m.lathe(r,'mint',[(0,.15),(.12,.15),(.12,.26),(0,.26)],(-.3,0,-.2))
lamp(m,r,(.3,.49,0));m.save('reservoirGarden')

# Architectural fountain, preserving the game's dormant/awake material transition.
m=Model();r=m.node('fountain')
m.lathe(r,'ivory',[(0,0),(.9,0),(.95,.06),(.95,.13),(.88,.17),(.87,.29),(.93,.31),(.93,.37),(.84,.4),(.78,.34),(.78,.2),(0,.2)],segments=48)
m.lathe(r,'ivory',[(0,.2),(.23,.2),(.24,.26),(.17,.32),(.1,.57),(.12,.76),(.24,.81),(.34,.9),(.36,1.02),(.31,1.05),(.26,.94),(.12,.9),(0,.9)])
m.ring(r,'gold',(0,.32,0),.9,.014)
for i in range(10):
 a=i*PI/5;m.orb(r,'cream',(.89*C(a),.23,.89*S(a)),(.07,.1,.07))
m.save('fountain')

# Rooftop gate frame. The gameplay crystal remains the readiness/charge indicator.
m=Model();r=m.node('coreArch');base(m,r,.9)
for side in (-1,1):
 points=[(side*.72,.15,0),(side*.72,1.1,0)]
 points += [(side*.72*C(t*PI/2),1.1+.95*S(t*PI/2),0) for t in [0,.15,.3,.45,.6,.75,.9,1]]
 m.tube(r,'ivory',points,.105)
 m.tube(r,'gold',[(x,y,z+.11) for x,y,z in points],.018)
 for i in range(9):
  a=i*.17;x=side*.76*C(a);y=1.05+.95*S(a)
  m.leaf(r,'leaf',(x,y,0),.24,i*1.8)
 for i in range(4):m.flower(r,(side*(.7-i*.08),1.4+i*.16,.08),'pink',.12)
m.save('coreArch')
