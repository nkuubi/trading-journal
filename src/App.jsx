import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient.js";

/* helpers */
const f2=n=>(n>=0?"+":"")+( +n||0).toFixed(2);
const fPnl=n=>{const v=+n||0;return(v>=0?"+$":"-$")+Math.abs(v).toFixed(2);};
const today=()=>new Date().toISOString().slice(0,10);
const monthNow=()=>new Date().toISOString().slice(0,7);
const totR=ts=>ts.reduce((s,t)=>s+(+t.result||0),0);
const wRate=ts=>ts.length?ts.filter(t=>t.outcome==="win").length/ts.length:0;
const getOut=r=>{const v=+r;return isNaN(v)?"be":v>0.05?"win":v<-0.05?"loss":"be";};
const maxDD=ts=>{const s=[...ts].sort((a,b)=>(a.date||"").localeCompare(b.date||""));let pk=0,c=0,d=0;s.forEach(t=>{c+=+t.result||0;if(c>pk)pk=c;if(pk-c>d)d=pk-c;});return d;};
const expectancy=ts=>{const w=ts.filter(t=>t.outcome==="win"),l=ts.filter(t=>t.outcome==="loss");if(!ts.length)return 0;return((w.length/ts.length)*(totR(w)/(w.length||1))-(l.length/ts.length)*(Math.abs(totR(l))/(l.length||1))).toFixed(3);};
const monthKey=d=>(d||"").slice(0,7)||"UNDATED";
const monthLabel=k=>{if(k==="UNDATED")return"UNDATED";const[y,m]=k.split("-");const MN=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];return MN[+m-1]+" "+y;};
const getAlerts=trades=>[...trades].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,30).map(t=>{
  const issues=[];
  if(t.tradingSystem!=="Elder"&&(!t.rhType||t.rhType==="None"))issues.push("No Rh structure logged");
  if(t.tradingSystem==="Hybrid"&&!t.entryThesis?.trim())issues.push("Hybrid trade missing entry thesis — can't verify both conditions were required");
  if(t.pivotWidth==="Wide"&&t.rr&&+t.rr<2)issues.push("Wide pivot + R:R < 2");
  if(+t.rr>0&&+t.rr<1.5)issues.push(`R:R too low (${(+t.rr).toFixed(2)}x)`);
  if(t.tripleScreen==="1")issues.push("Only 1 Elder screen aligned");
  if(t.tradingSystem==="Elder"&&t.impulseSystem?.startsWith("Red")&&t.direction==="Long")issues.push("Long entry on Red impulse bar");
  if(t.tradingSystem==="Elder"&&t.impulseSystem?.startsWith("Green")&&t.direction==="Short")issues.push("Short entry on Green impulse bar");
  if(t.rules==="No")issues.push("Rules broken");
  if(t.emoPre==="FOMO"||t.emoPre==="Revenge")issues.push(`Emotional entry (${t.emoPre})`);
  if(t.entryQuality&&+t.entryQuality<=2)issues.push("Quality ≤ 2/5");
  return issues.length?{t,issues}:null;
}).filter(Boolean);

const ALL_FIELDS=["date","pair","session","timeframe","direction","tradingSystem","entryThesis","wouldTakeRossAlone","wouldTakeElderAlone","rhType","entryType","pivotWidth","attempt","maCross","valueZone","impulseSystem","divergence","htf","tripleScreen","entryQuality","volatility","newsImpact","rules","entry","sl","tp","exitPrice","exitReason","result","pnl","rr","overnightFin","emoPre","emoPost","tags","chartUrl","chartPost","chartDaily","notes"];
const EXIT_REASONS=["Stop Loss Hit (Rh Pivot)","Profit Target Hit (R-multiple)","Hit Resistance (Long exit)","Hit Support (Short exit)","Opposing Hook","Ledge Break","MA Cross","Trailing Stop Hit","RSI/MACD Divergence","Time Stop","Manual / Discretionary"];

const doCSV=trades=>{
  const esc=v=>{const s=String(v??"");return(s.includes(",")||s.includes('"')||s.includes("\n"))?`"${s.replace(/"/g,'""')}\"`:s;};
  const csv=[ALL_FIELDS.join(","),...trades.map(t=>ALL_FIELDS.map(k=>esc(t[k])).join(","))].join("\n");
  const b=new Blob([csv],{type:"text/csv;charset=utf-8;"});const u=URL.createObjectURL(b);
  const a=document.createElement("a");a.href=u;a.download="trades_"+today()+".csv";document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(u);document.body.removeChild(a);},200);
};
/* Supabase-backed key/value store. Each row is (user_id, key) -> jsonb value,
   scoped by Row Level Security so a signed-in user only ever sees their own
   rows — see supabase/schema.sql. Values round-trip as plain JS values since
   the column is jsonb (no manual JSON.stringify/parse needed). */
async function load(k,fb){
  try{
    const {data,error}=await supabase.from("kv").select("value").eq("key",k).maybeSingle();
    if(error||!data)return fb;
    return data.value??fb;
  }catch{return fb;}
}
async function sv(k,v){
  try{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return false;
    const{error}=await supabase.from("kv").upsert(
      {user_id:user.id,key:k,value:v,updated_at:new Date().toISOString()},
      {onConflict:"user_id,key"}
    );
    return!error;
  }catch{return false;}
}

const DEF_ACCS=["PROP FIRM","DEMO"];
const SESSIONS=["London","New York","Asian","Overlap"];
const TFS=["M5","M15","H1","H4","Daily"];
const SYSTEMS=["Joe Ross","Elder","Hybrid"];
const RH_TYPES=["None","Ross Hook Long","Ross Hook Short","1-2-3 Bottom","1-2-3 Top","Ledge Long","Ledge Short","Congestion Long","Congestion Short"];
const ENTRY_T=["Standard Breakout","TTE (Trader's Trick)","Pullback Re-entry"];
const PIVOT_W=["Tight","Normal","Wide"];
const ATTEMPTS=["1st","2nd Re-entry","3rd+"];
const MA_CROSS=["Bullish Cross","Bearish Cross","No Cross"];
const VALUE_ZONE=["In Value Zone","Outside Value Zone"];
const IMPULSE=["Green (no new shorts)","Blue (neutral)","Red (no new longs)"];
const DIVERGENCE=["None","Bullish Divergence","Bearish Divergence"];
const EMO=["Calm","Confident","FOMO","Revenge","Anxious","Bored","Neutral"];
const EMO_POST=["Satisfied","Confident","Neutral","Frustrated","Regretful","Relieved","Disappointed","Overjoyed","Indifferent"];
const BIAS_OPTS=["Strong Bull","Bullish","Neutral","Bearish","Strong Bear"];
const biasColor=b=>b?.includes("Bull")?"#00cc44":b?.includes("Bear")?"#cc2200":"#555";
const LI_DOMAINS=[
  {id:"sleep",label:"SLEEP",max:10,color:"#00aaff",metrics:[
    {id:"s1",label:"Hours slept",opts:[["≥ 8 hrs",4],["7–8 hrs",3],["6–7 hrs",2],["5–6 hrs",1],["< 5 hrs",0]]},
    {id:"s2",label:"Bed on schedule",opts:[["On time",3],["< 30 min late",2],["Late",1],["Very late",0]]},
    {id:"s3",label:"Woke feeling",opts:[["Fully rested",3],["Somewhat rested",2],["Slightly tired",1],["Very tired",0]]},
  ]},
  {id:"physical",label:"PHYSICAL",max:10,color:"#00cc44",metrics:[
    {id:"p1",label:"Energy level",opts:[["High",4],["Normal",3],["Low",1],["Very low",0]]},
    {id:"p2",label:"Exercise (yesterday)",opts:[["45+ min",3],["20–45 min",2],["Light",1],["None",0]]},
    {id:"p3",label:"Physical wellbeing",opts:[["No issues",3],["Minor discomfort",2],["Moderate",1],["Significant",0]]},
  ]},
  {id:"mind",label:"MIND & STRESS",max:10,color:"#ffaa33",metrics:[
    {id:"m1",label:"Stress level",opts:[["Very low",4],["Low",3],["Moderate",2],["High",1],["Very high",0]]},
    {id:"m2",label:"Mental clarity",opts:[["Sharp",3],["Normal",2],["Foggy",1],["Very foggy",0]]},
    {id:"m3",label:"Unresolved concerns",opts:[["None",3],["Minor",2],["Significant",1],["Overwhelming",0]]},
  ]},
  {id:"financial",label:"FINANCIAL PRESSURE",max:10,color:"#ff8c00",metrics:[
    {id:"f1",label:"External financial stress",opts:[["None",4],["Low",3],["Moderate",2],["High",0]]},
    {id:"f2",label:"Account pressure",opts:[["None",3],["Minor concern",2],["In drawdown",1],["Heavy pressure",0]]},
    {id:"f3",label:"P&L affecting mood",opts:[["Not at all",3],["Slightly",2],["Moderately",1],["Significantly",0]]},
  ]},
];
const liMax=40;
const liScore=sel=>LI_DOMAINS.reduce((t,d)=>t+d.metrics.reduce((dt,m)=>dt+(sel[m.id]??0),0),0);
const liDomScore=(d,sel)=>d.metrics.reduce((s,m)=>s+(sel[m.id]??0),0);
const liGate=s=>s>=32?"OPTIMAL — FULL SIZE":s>=24?"GOOD — STANDARD SIZE":s>=16?"MARGINAL — REDUCE SIZE":"POOR — DO NOT TRADE";
const liColor=s=>s>=32?"#00cc44":s>=24?"#ffaa33":s>=16?"#ff8c00":"#cc2200";

/* Entry quality now adapts to the active system */
const QF_ROSS=[
  {text:"+1  STRUCTURE — Clean Rh pivot identified (rhType ≠ None)",auto:t=>t.rhType&&t.rhType!=="None"},
  {text:"+1  DIRECTION — HTF/Daily bias clearly aligned (not Neutral)",auto:t=>t.htf&&t.htf!=="Neutral"},
  {text:"+1  RISK/WIDTH — Tight or Normal pivot width",auto:t=>t.pivotWidth!=="Wide"},
  {text:"+1  RISK/REWARD — R:R ≥ 1:2 (calculated before entry)",auto:t=>+t.rr>=2},
  {text:"+1  DISCIPLINE — Rules followed, calm state, no Red/Orange news",auto:t=>t.rules==="Yes"&&t.emoPre!=="FOMO"&&t.emoPre!=="Revenge"&&t.newsImpact!=="Red"&&t.newsImpact!=="Orange"},
];
const QF_ELDER=[
  {text:"+1  TRIPLE SCREEN — all 3 screens aligned",auto:t=>t.tripleScreen==="3"},
  {text:"+1  IMPULSE — entry not against impulse system color",auto:t=>!((t.impulseSystem||"").startsWith("Red")&&t.direction==="Long")&&!((t.impulseSystem||"").startsWith("Green")&&t.direction==="Short")},
  {text:"+1  VALUE ZONE — entry taken inside the value zone",auto:t=>t.valueZone==="In Value Zone"},
  {text:"+1  RISK/REWARD — R:R ≥ 1:2 (calculated before entry)",auto:t=>+t.rr>=2},
  {text:"+1  DISCIPLINE — Rules followed, calm state, no Red/Orange news",auto:t=>t.rules==="Yes"&&t.emoPre!=="FOMO"&&t.emoPre!=="Revenge"&&t.newsImpact!=="Red"&&t.newsImpact!=="Orange"},
];
const elderBlocked=t=>((t.impulseSystem||"").startsWith("Red")&&t.direction==="Long")||((t.impulseSystem||"").startsWith("Green")&&t.direction==="Short");
const discipline=t=>t.rules==="Yes"&&t.emoPre!=="FOMO"&&t.emoPre!=="Revenge"&&t.newsImpact!=="Red"&&t.newsImpact!=="Orange";
/* Hybrid is an AND of both systems' gates, not a blended subset — each line below only
   passes when BOTH the Ross condition AND the matching Elder condition hold. A trade that
   only satisfies one side scores lower here than it would under that system alone, which is
   the point: Hybrid should be harder to pass cleanly, not easier. */
const QF_HYBRID=[
  {text:"+1  STRUCTURE — Rh/1-2-3 valid AND all 3 Elder screens aligned",auto:t=>(t.rhType&&t.rhType!=="None")&&t.tripleScreen==="3"},
  {text:"+1  ENTRY ZONE — Tight/Normal pivot AND inside Elder's value zone",auto:t=>t.pivotWidth!=="Wide"&&t.valueZone==="In Value Zone"},
  {text:"+1  MOMENTUM/DIRECTION — HTF bias aligned AND not against impulse colour",auto:t=>t.htf&&t.htf!=="Neutral"&&!elderBlocked(t)},
  {text:"+1  RISK/REWARD — R:R ≥ 1:2 (calculated before entry)",auto:t=>+t.rr>=2},
  {text:"+1  DISCIPLINE — Rules followed, calm state, no Red/Orange news",auto:discipline},
];
const qfFor=t=>t.tradingSystem==="Elder"?QF_ELDER:t.tradingSystem==="Hybrid"?QF_HYBRID:QF_ROSS;
const autoQ=t=>qfFor(t).filter(q=>q.auto(t)).length;

const CHECKS_ROSS=[
  {id:"c1",sec:"STRUCTURE",text:"Ross Hook clearly identified"},
  {id:"c2",sec:"STRUCTURE",text:"1-2-3 / Ledge / Congestion preceded Rh"},
  {id:"c3",sec:"STRUCTURE",text:"Entry type decided: Standard or TTE?"},
  {id:"c4",sec:"STRUCTURE",text:"Stop at Rh pivot — not arbitrary"},
  {id:"c5",sec:"STRUCTURE",text:"No major S/R blocking the trade"},
  {id:"c13",sec:"TRIPLE SCREEN",text:"HTF (4H/Daily) trend aligns"},
  {id:"c15",sec:"TRIPLE SCREEN",text:"Lower TF entry confirmed"},
  {id:"c16",sec:"RISK",text:"R:R ≥ 1:2 (especially Wide pivot)"},
  {id:"c17",sec:"RISK",text:"Position size ≤ 2% risk"},
  {id:"c18",sec:"RISK",text:"No major news within 30 min"},
  {id:"c19",sec:"PSYCHOLOGY",text:"Readiness score ≥ 6"},
  {id:"c20",sec:"PSYCHOLOGY",text:"Trading because the setup exists — not boredom, FOMO, or recovering losses"},
];
const CHECKS_ELDER=[
  {id:"e1",sec:"SCREEN 1 — WEEKLY TIDE",text:"Weekly trend/MACD-Histogram direction identified"},
  {id:"e2",sec:"SCREEN 2 — DAILY WAVE",text:"Daily oscillator (Stochastic/RSI) pulls against weekly tide"},
  {id:"e3",sec:"SCREEN 2 — DAILY WAVE",text:"Not trading against the weekly tide"},
  {id:"e4",sec:"SCREEN 3 — ENTRY",text:"Intraday breakout / trailing buy-stop or sell-stop set"},
  {id:"e5",sec:"IMPULSE SYSTEM",text:"Entry direction not blocked by impulse system colour"},
  {id:"e6",sec:"VALUE ZONE",text:"Entry inside the value zone between fast & slow EMA"},
  {id:"e7",sec:"EXIT PLAN",text:"Divergence (RSI/MACD) checked as early exit warning"},
  {id:"e16",sec:"RISK",text:"R:R ≥ 1:2"},
  {id:"e17",sec:"RISK",text:"Position size ≤ 2% risk (2% Rule)"},
  {id:"e18",sec:"RISK",text:"No major news within 30 min"},
  {id:"e19",sec:"PSYCHOLOGY",text:"Readiness score ≥ 6"},
  {id:"e20",sec:"PSYCHOLOGY",text:"Trading because the setup exists — not boredom, FOMO, or recovering losses"},
];

const BLANK={date:today(),pair:"",session:"London",timeframe:"H1",direction:"Long",
  tradingSystem:"Joe Ross",
  entryThesis:"",wouldTakeRossAlone:"",wouldTakeElderAlone:"",
  rhType:"Ross Hook Long",entryType:"Standard Breakout",pivotWidth:"Normal",attempt:"1st",
  maCross:"No Cross",valueZone:"In Value Zone",impulseSystem:"Blue (neutral)",divergence:"None",
  htf:"Bullish",tripleScreen:"2",entryQuality:"3",volatility:"Normal",newsImpact:"None",rules:"Yes",
  entry:"",sl:"",tp:"",exitPrice:"",exitReason:"",result:"",pnl:"",rr:"",overnightFin:"",
  emoPre:"Calm",emoPost:"Neutral",tags:"",chartUrl:"",chartPost:"",chartDaily:"",notes:""};

const CSS=[
  "*{box-sizing:border-box;margin:0;padding:0}body{background:#000;color:#ff8c00;font-family:'Courier New',monospace}",
  "::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#333}",
  "input,select,textarea{background:#0a0a0a;border:1px solid #333;color:#ff8c00;padding:4px 7px;font-family:inherit;font-size:11px;outline:none;width:100%}",
  "input:focus,select:focus,textarea:focus{border-color:#ff8c00}select option{background:#0a0a0a}textarea{resize:vertical;min-height:40px}button{cursor:pointer;font-family:inherit}",
  ".btn{padding:3px 10px;border:1px solid #333;background:#0a0a0a;color:#888;font-size:11px;letter-spacing:1px}.btn:hover{border-color:#ff8c00;color:#ff8c00}",
  ".bp{background:#ff8c00!important;color:#000!important;border-color:#ff8c00!important;font-weight:bold}.bd{color:#cc2200!important;border:none!important;background:transparent!important}",
  ".panel{background:#0a0a0a;border:1px solid #222;padding:10px 12px;margin-bottom:1px}.ph{font-size:9px;letter-spacing:3px;color:#ff8c00;border-bottom:1px solid #222;padding-bottom:5px;margin-bottom:10px}",
  ".sec{font-size:9px;letter-spacing:2px;color:#555;border-left:2px solid #ff8c00;padding-left:6px;margin:10px 0 6px}.fl{font-size:9px;letter-spacing:1px;color:#555;display:block;margin-bottom:2px}",
  ".frow{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:8px}",
  ".kgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:1px;background:#111}",
  ".kpi{background:#0a0a0a;padding:8px 10px}.kl{font-size:8px;letter-spacing:2px;color:#555}.kv{font-size:16px;font-weight:bold}",
  ".knav{display:flex;gap:3px;padding:5px 12px;background:#000;border-bottom:1px solid #111;position:sticky;top:0;z-index:100;flex-wrap:wrap}",
  ".kb{display:inline-flex;flex-direction:column;align-items:center;gap:1px;padding:3px 8px;border:1px solid #1a1a1a;background:#050505;color:#444;min-width:34px;cursor:pointer;font-family:inherit;transition:all .15s}",
  ".kb:hover{border-color:#666;color:#888}.kb.on{border-color:#ff8c00;color:#ff8c00;background:#0d0600}",
  ".kb-k{font-size:12px;font-weight:bold;line-height:1}.kb-l{font-size:7px;letter-spacing:1px;line-height:1;text-transform:uppercase}",
  "table{width:100%;border-collapse:collapse;font-size:11px}th{padding:4px 8px;text-align:left;font-size:9px;letter-spacing:2px;color:#555;border-bottom:1px solid #1a1a1a;white-space:nowrap}",
  "td{padding:3px 8px;border-bottom:1px solid #0f0f0f;white-space:nowrap}tr:hover td{background:#0f0f0f}",
  ".win{color:#00cc44}.loss{color:#cc2200}.be{color:#888}.long{color:#ff8c00}.short{color:#00aaff}",
  ".chip{display:inline-block;padding:1px 6px;font-size:9px;letter-spacing:1px;font-weight:bold}",
  ".g2{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#111}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#111}",
  ".esel{padding:2px 8px;border:1px solid #222;background:transparent;color:#555;font-size:10px}.esel:hover{border-color:#555;color:#888}.esel.on{border-color:#ff8c00;color:#ff8c00;background:#110800}",
  ".tabrow{display:flex;border-bottom:1px solid #222;margin-bottom:10px;flex-wrap:wrap}.tb{background:transparent;border:none;border-bottom:2px solid transparent;padding:5px 12px;font-size:9px;color:#444}.tb:hover{color:#888}.tb.on{color:#ff8c00;border-bottom-color:#ff8c00}",
  ".toast{position:fixed;bottom:12px;right:12px;background:#000;border:1px solid #ff8c00;color:#ff8c00;padding:6px 12px;font-size:10px;letter-spacing:2px;z-index:9999}",
  ".ai-out{white-space:pre-wrap;font-size:11px;line-height:1.7;color:#ccc;padding:12px;background:#050505;border:1px solid #1a1a1a;min-height:80px}",
  "input[type=range]{padding:0;height:16px;accent-color:#ff8c00}",
  ".mhead{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#0e0e0e;border:1px solid #1e1e1e;cursor:pointer;margin-bottom:1px}.mhead:hover{border-color:#333}",
  ".mcaret{width:10px;color:#555;font-size:10px}",
].join("");

function Kpi({l,v,c}){return(<div className="kpi"><div className="kl">{l}</div><div className="kv" style={{color:c}}>{v}</div></div>);}
function GoalBar({label,cur,tgt,unit}){
  const pct=tgt>0?Math.min(100,cur/tgt*100):0,c=pct>=100?"#00cc44":pct>=70?"#ffaa33":"#ff8c00";
  return(<div style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#555",marginBottom:2}}><span>{label}</span><span style={{color:c}}>{parseFloat(cur).toFixed(1)}{unit} / {tgt}{unit}</span></div><div style={{height:4,background:"#111"}}><div style={{width:pct+"%",height:4,background:c,transition:"width .3s"}}/></div></div>);
}
function Badge({type}){
  if(!type)return null;
  const isTTE=type.includes("TTE"),isPull=type.includes("Pull");
  return(<span className="chip" style={{background:isTTE?"#001830":isPull?"#0a0a00":"#180800",border:"1px solid "+(isTTE?"#00aaff":isPull?"#888800":"#ff8c00"),color:isTTE?"#00aaff":isPull?"#aaaa00":"#ff8c00"}}>{isTTE?"TTE":isPull?"PULL":"BRK"}</span>);
}
function SysBadge({sys}){
  const col=sys==="Elder"?"#00aaff":sys==="Hybrid"?"#cc66ff":"#ff8c00";
  const bg=sys==="Elder"?"#001830":sys==="Hybrid"?"#1a0030":"#180800";
  return(<span className="chip" style={{background:bg,border:"1px solid "+col,color:col}}>{sys==="Elder"?"ELDER":sys==="Hybrid"?"HYBRID":"JOE ROSS"}</span>);
}

/* Sparkline — accepts deposits/bonuses as step-up markers on the curve */
function Sparkline({trades, deposits=[]}){
  const [maPer,setMaPer]=useState(10);
  const tradePts=[...trades].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const depPts=[...deposits].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  let cum=0;
  const pts=tradePts.map(t=>{cum+=+t.result||0;return{date:t.date||"",v:cum};});
  if(pts.length<2)return(<div style={{color:"#333",fontSize:10,padding:20,textAlign:"center"}}>NO DATA</div>);
  const ma=pts.map((_,i)=>i<maPer-1?null:pts.slice(i-maPer+1,i+1).reduce((s,p)=>s+p.v,0)/maPer);
  const vals=pts.map(p=>p.v);
  const allV=[...vals,...ma.filter(v=>v!==null)];
  const W=440,H=70,p=4,mn=Math.min(...allV),mx=Math.max(...allV),rng=mx-mn||1;
  const sx=i=>p+i/(pts.length-1)*(W-p*2),sy=v=>p+(mx-v)/rng*(H-p*2);
  const eq=vals.map((v,i)=>(i?"L":"M")+sx(i).toFixed(1)+","+sy(v).toFixed(1)).join(" ");
  const maPath=ma.reduce((acc,v,i)=>v===null?acc:acc+(acc===""?"M":"L")+sx(i).toFixed(1)+","+sy(v).toFixed(1),"");
  const lc=vals[vals.length-1]>=0?"#00cc44":"#ff8c00";
  const lastE=vals[vals.length-1],lastMA=ma[ma.length-1];
  const aboveMA=lastMA!==null&&lastE>lastMA;
  const prevMA=lastMA!==null?ma.slice(0,-1).filter(v=>v!==null):[];
  const maSlope=prevMA.length?lastMA-prevMA[prevMA.length-1]:0;
  const gap=lastMA!==null?(lastE-lastMA).toFixed(2):null;
  const crossIdx=lastMA!==null?(()=>{
    for(let i=pts.length-2;i>=0;i--){if(ma[i]===null)continue;const wasAbove=vals[i]>ma[i];if(wasAbove!==aboveMA)return pts.length-1-i;}return null;
  })():null;
  const firstDate=pts[0]?.date||"";
  const lastDate=pts[pts.length-1]?.date||"";
  const depMarkers=depPts.filter(d=>d.date>=firstDate&&d.date<=lastDate).map(d=>{
    let nearestIdx=0;
    for(let i=0;i<pts.length;i++){if(pts[i].date<=d.date)nearestIdx=i;}
    return{x:sx(nearestIdx),amount:d.amount,label:d.label||"",date:d.date,type:d.type};
  });
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
        <div style={{display:"flex",gap:10,fontSize:8}}>
          <span style={{color:lc}}>■ EQUITY (R)</span>
          <span style={{color:"rgba(255,255,255,0.5)"}}>— MA({maPer})</span>
          {depMarkers.length>0&&<span style={{color:"#00aaff"}}>↑ CAPITAL EVENT</span>}
        </div>
        <div style={{display:"flex",gap:2}}>
          {[5,10,20].map(n=>(<button key={n} onClick={()=>setMaPer(n)} style={{padding:"1px 6px",border:"1px solid "+(maPer===n?"#aaa":"#222"),background:"transparent",color:maPer===n?"#fff":"#444",fontSize:8,cursor:"pointer",fontFamily:"monospace"}}>{n}</button>))}
        </div>
      </div>
      <svg width={W} height={H}>
        <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lc} stopOpacity="0.15"/><stop offset="100%" stopColor={lc} stopOpacity="0"/></linearGradient></defs>
        <path d={eq+" L"+sx(pts.length-1)+","+H+" L"+sx(0)+","+H+" Z"} fill="url(#sg)"/>
        <path d={eq} fill="none" stroke={lc} strokeWidth="1.5"/>
        {maPath&&<path d={maPath} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2"/>}
        {depMarkers.map((d,i)=>(
          <g key={i}>
            <line x1={d.x} y1={0} x2={d.x} y2={H} stroke={d.type==="Withdrawal"?"#cc4400":"#00aaff"} strokeWidth="1" strokeDasharray="3,2" opacity="0.7"/>
            <circle cx={d.x} cy={4} r="3" fill={d.type==="Withdrawal"?"#cc4400":"#00aaff"} opacity="0.9"/>
            <text x={d.x+4} y={12} fill={d.type==="Withdrawal"?"#cc4400":"#00aaff"} fontSize="7" fontFamily="Courier New">{d.type==="Withdrawal"?"-":"+"}${(+d.amount||0).toLocaleString()}</text>
          </g>
        ))}
        <circle cx={sx(pts.length-1)} cy={sy(lastE)} r="3" fill={lc}/>
        {lastMA!==null&&<circle cx={sx(pts.length-1)} cy={sy(lastMA)} r="2.5" fill="rgba(255,255,255,0.6)"/>}
        {lastMA!==null&&<line x1={sx(pts.length-1)} y1={Math.min(sy(lastE),sy(lastMA))} x2={sx(pts.length-1)} y2={Math.max(sy(lastE),sy(lastMA))} stroke={aboveMA?"#00cc44":"#cc2200"} strokeWidth="1" strokeDasharray="2,2"/>}
      </svg>
      {lastMA!==null&&(
        <div style={{display:"flex",gap:14,marginTop:4,fontSize:8,flexWrap:"wrap"}}>
          <span style={{color:aboveMA?"#00cc44":"#cc2200",fontWeight:"bold"}}>{aboveMA?"▲ ABOVE MA":"▼ BELOW MA"}</span>
          <span style={{color:"#555"}}>GAP <span style={{color:aboveMA?"#00cc44":"#cc2200"}}>{+gap>=0?"+":""}{gap}R</span></span>
          <span style={{color:"#555"}}>MA SLOPE <span style={{color:maSlope>0.05?"#00cc44":maSlope<-0.05?"#cc2200":"#888"}}>{maSlope>0.05?"↗ RISING":maSlope<-0.05?"↘ FALLING":"→ FLAT"}</span></span>
          {crossIdx!==null&&<span style={{color:"#555"}}>LAST CROSS <span style={{color:"#ff8c00"}}>{crossIdx}T AGO</span></span>}
        </div>
      )}
    </div>
  );
}

function HeatCell({label,arr}){
  const wr=arr.length?wRate(arr):null,rv=wr===null?13:Math.round(180*(1-wr)),gv=wr===null?13:Math.round(180*wr);
  return(<div style={{textAlign:"center"}}><div style={{fontSize:9,color:"#555",marginBottom:3}}>{label}</div><div style={{height:68,background:`rgb(${rv},${gv},0)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:17,fontWeight:"bold",color:"#fff"}}>{wr!==null?(wr*100).toFixed(0)+"%":"--"}</div><div style={{fontSize:8,color:"rgba(255,255,255,0.4)"}}>{arr.length?"n="+arr.length:""}</div></div><div style={{fontSize:9,color:"#444",marginTop:3}}>{arr.length?f2(totR(arr))+"R":""}</div></div>);
}
/* minSample: below this trade count, WR/R figures are too noisy to act on — shown
   dimmed with a "low n" marker instead of green/red, rather than implying confidence
   the sample doesn't support. Default 15 is a soft floor, not a statistical guarantee. */
function BT({rows,colorFn,minSample=15}){
  return(<table><thead><tr>{["CATEGORY","N","WIN%","TOTAL R","AVG R"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=>{
    const low=r.n<minSample;
    const c=low?"#444":(colorFn?colorFn(r.label):null)||(r.wr!==null?(+r.wr>=50?"#00cc44":"#cc2200"):"#333");
    const rc=low?"#444":(+r.r>=0?"#00cc44":"#cc2200");
    return(<tr key={i}><td style={{color:"#ff8c00",fontSize:10}}>{r.label}</td><td style={{color:low?"#ffaa33":undefined}}>{r.n}{low?"*":""}</td><td style={{color:c}}>{r.wr!==null?r.wr+"%":"--"}</td><td style={{color:rc}}>{f2(r.r)+"R"}</td><td style={{color:low?"#444":undefined}}>{r.n?f2((+r.r/r.n).toFixed(3))+"R":"--"}</td></tr>);
  })}</tbody>
  {rows.some(r=>r.n<minSample)&&<tfoot><tr><td colSpan={5} style={{color:"#444",fontSize:8,paddingTop:6,borderBottom:"none"}}>* fewer than {minSample} trades — win rate / R figures are low-confidence, treat as directional only</td></tr></tfoot>}
  </table>);
}

/* ── DEPOSIT MANAGER — Deposits / Bonus / Withdrawals ── */
function DepositManager({deposits, saveDeposits, showToast}){
  const TYPES=["Deposit","Bonus","Withdrawal"];
  const TYPE_COLOR={Deposit:"#00cc44",Bonus:"#00aaff",Withdrawal:"#cc2200"};
  const [tab,setTab]=useState("Deposit");
  const [form,setForm]=useState({date:today(),amount:"",label:"",type:"Deposit",broker:""});
  const F=(k,v)=>setForm(p=>({...p,[k]:v}));
  const totalsByType=TYPES.reduce((acc,t)=>{acc[t]=deposits.filter(d=>d.type===t).reduce((s,d)=>s+(+d.amount||0),0);return acc;},{});
  const netCapital=totalsByType.Deposit+totalsByType.Bonus-totalsByType.Withdrawal;

  const handleSave=async()=>{
    if(!form.amount||isNaN(+form.amount)||+form.amount<=0){showToast("ENTER VALID AMOUNT");return;}
    const entry={...form,type:tab,id:Date.now()+Math.random(),amount:+form.amount};
    const ok=await saveDeposits([entry,...deposits]);
    if(ok===false){showToast("SAVE FAILED — TRY AGAIN");return;}
    setForm({date:today(),amount:"",label:"",type:tab,broker:""});
    showToast(tab.toUpperCase()+" LOGGED");
  };

  const filteredHistory=[...deposits].filter(d=>d.type===tab).sort((a,b)=>(b.date||"").localeCompare(a.date||""));

  return(
    <div>
      <div className="kgrid" style={{marginBottom:1}}>
        <Kpi l="TOTAL DEPOSITED" v={"$"+totalsByType.Deposit.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} c={TYPE_COLOR.Deposit}/>
        <Kpi l="TOTAL BONUS" v={"$"+totalsByType.Bonus.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} c={TYPE_COLOR.Bonus}/>
        <Kpi l="TOTAL WITHDRAWN" v={"$"+totalsByType.Withdrawal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} c={TYPE_COLOR.Withdrawal}/>
        <Kpi l="NET CAPITAL IN" v={"$"+netCapital.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} c={netCapital>=0?"#00cc44":"#cc2200"}/>
      </div>

      <div className="tabrow">
        {TYPES.map(t=>(<button key={t} className={"tb"+(tab===t?" on":"")} style={{color:tab===t?TYPE_COLOR[t]:undefined,borderBottomColor:tab===t?TYPE_COLOR[t]:undefined}} onClick={()=>{setTab(t);setForm(p=>({...p,type:t}));}}>{t.toUpperCase()}</button>))}
      </div>

      <div className="panel">
        <div className="ph">LOG {tab.toUpperCase()}</div>
        <div className="frow">
          <div><label className="fl">DATE</label><input type="date" value={form.date} onChange={e=>F("date",e.target.value)}/></div>
          <div><label className="fl">AMOUNT ($)</label><input type="number" step="any" min="0" value={form.amount} onChange={e=>F("amount",e.target.value)} placeholder="1000.00"/></div>
          {tab==="Bonus"&&<div><label className="fl">BROKER</label><input value={form.broker} onChange={e=>F("broker",e.target.value)} placeholder="e.g. Prop Firm X"/></div>}
          <div><label className="fl">LABEL / NOTE</label><input value={form.label} onChange={e=>F("label",e.target.value)} placeholder={tab==="Bonus"?"Deposit match, promo…":tab==="Withdrawal"?"Profit withdrawal…":"Initial deposit…"}/></div>
        </div>
        <button className="btn bp" style={{borderColor:TYPE_COLOR[tab],color:TYPE_COLOR[tab]}} onClick={handleSave}>SAVE {tab.toUpperCase()}</button>
      </div>

      <div className="panel">
        <div className="ph">{tab.toUpperCase()} HISTORY</div>
        {!filteredHistory.length
          ?<div style={{color:"#333",fontSize:10,textAlign:"center",padding:14}}>NO {tab.toUpperCase()} ENTRIES YET</div>
          :<div style={{overflowX:"auto"}}>
            <table>
              <thead><tr>{["DATE","AMOUNT",tab==="Bonus"?"BROKER":"LABEL",""].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {filteredHistory.map((d,i)=>(
                  <tr key={d.id||i}>
                    <td style={{color:"#555"}}>{d.date}</td>
                    <td style={{color:TYPE_COLOR[d.type],fontWeight:"bold"}}>{d.type==="Withdrawal"?"-":"+"}${(+d.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                    <td style={{color:"#555",fontSize:10}}>{(d.type==="Bonus"?d.broker:d.label)||"--"}</td>
                    <td><button className="btn bd" onClick={async()=>{await saveDeposits(deposits.filter(x=>(x.id||x)!==d.id));showToast("DELETED");}}>DEL</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        }
      </div>
    </div>
  );
}

/* APP */
function JournalApp(){
  const [page,setPage]=useState("dash");
  const [account,setAccount]=useState("PROP FIRM");
  const [accounts,setAccounts]=useState(DEF_ACCS);
  const [trades,setTrades]=useState([]);
  const [deposits,setDeposits]=useState([]);
  const [checkLog,setCheckLog]=useState([]);
  const [reviews,setReviews]=useState({daily:[],weekly:[]});
  const [mood,setMood]=useState([]);
  const [goals,setGoals]=useState({monthlyR:20,weeklyR:5,winRate:55,monthlyTrades:20});
  const [settings,setSettings]=useState({dailyLimit:3,monthlyLimit:6});
  const [htfLog,setHtfLog]=useState([]);
  const [lifeLog,setLifeLog]=useState([]);
  const [toast,setToast]=useState("");
  const [loading,setLoading]=useState(true);
  const [newAcc,setNewAcc]=useState("");
  const [clock,setClock]=useState(new Date());

  useEffect(()=>{const t=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(t);},[]);
  useEffect(()=>{
    const map={d:"dash",l:"log",c:"check",r:"review",a:"analytics",g:"goals",i:"ai",s:"sizer",h:"htf",p:"deposits"};
    const fn=e=>{const tag=(document.activeElement||{}).tagName;if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return;if(map[e.key.toLowerCase()])setPage(map[e.key.toLowerCase()]);};
    window.addEventListener("keydown",fn);return()=>window.removeEventListener("keydown",fn);
  },[]);

  const loadAll=useCallback(async acc=>{
    setLoading(true);const K=acKey(acc);
    const [t,c,r,m,g,s,accs,h,li,dep]=await Promise.all([
      load(K+":t",[]),load(K+":c",[]),load(K+":r",{daily:[],weekly:[]}),
      load(K+":m",[]),load(K+":g",{monthlyR:20,weeklyR:5,winRate:55,monthlyTrades:20}),
      load(K+":s",{dailyLimit:3,monthlyLimit:6}),load("app:accounts",DEF_ACCS),
      load(K+":h",[]),load(K+":li",[]),
      load(K+":dep",[]),
    ]);
    setTrades(t);setCheckLog(c);setReviews(r);setMood(m);setGoals(g);setSettings(s);
    setAccounts(accs);setHtfLog(h);setLifeLog(li);setDeposits(dep);
    setLoading(false);
  },[]);

  useEffect(()=>{loadAll(account);},[account,loadAll]);
  const K=acKey(account);
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),2500);};
  const saveTrades=async t=>{setTrades(t);const ok=await sv(K+":t",t);if(!ok)showToast("SAVE FAILED");return ok;};
  const saveDeposits=async d=>{setDeposits(d);const ok=await sv(K+":dep",d);if(!ok)showToast("SAVE FAILED");return ok;};
  const saveCheckLog=async c=>{setCheckLog(c);await sv(K+":c",c);};
  const saveReviews=async r=>{setReviews(r);await sv(K+":r",r);};
  const saveMood=async m=>{setMood(m);await sv(K+":m",m);};
  const saveGoals=async g=>{setGoals(g);await sv(K+":g",g);};
  const saveSettings=async s=>{setSettings(s);await sv(K+":s",s);};
  const saveHtfLog=async h=>{setHtfLog(h);await sv(K+":h",h);};
  const saveLifeLog=async li=>{setLifeLog(li);await sv(K+":li",li);};
  const addAccount=async()=>{const name=newAcc.trim().toUpperCase();if(!name||accounts.includes(name))return;const next=[...accounts,name];setAccounts(next);await sv("app:accounts",next);setNewAcc("");setAccount(name);showToast("CREATED "+name);};

  const mTrades=trades.filter(t=>t.date?.startsWith(monthNow()));
  const todayR=totR(trades.filter(t=>t.date===today()));
  const monthR=totR(mTrades);
  const dayBreach=todayR<0&&Math.abs(todayR)>=settings.dailyLimit;
  const monBreach=monthR<0&&Math.abs(monthR)>=settings.monthlyLimit;
  const todayMood=mood.find(m=>m.date===today());
  const todayLI=lifeLog.find(e=>e.date===today());

  const totalDeposited=deposits.filter(d=>d.type==="Deposit").reduce((s,d)=>s+(+d.amount||0),0);
  const totalBonus=deposits.filter(d=>d.type==="Bonus").reduce((s,d)=>s+(+d.amount||0),0);
  const netPnlDollar=trades.reduce((s,t)=>s+(+t.pnl||0)+(+t.overnightFin||0),0);

  if(loading)return(<div style={{background:"#000",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Courier New",color:"#ff8c00",textAlign:"center"}}><div><div style={{fontSize:9,letterSpacing:4,color:"#444"}}>JOE ROSS + ELDER</div><div style={{fontSize:20,letterSpacing:6,marginTop:6}}>TRADING JOURNAL v10</div></div></div>);

  const NAV=[["dash","DASH","D"],["log","LOG","L"],["check","CHECK","C"],["review","REVIEW","R"],["analytics","ANALYTICS","A"],["goals","GOALS","G"],["deposits","DEPOSITS","P"],["ai","AI","I"],["sizer","SIZER","S"],["htf","HTF","H"]];
  return(
    <div style={{background:"#000",minHeight:"100vh",color:"#ff8c00",fontFamily:"'Courier New',monospace"}}>
      <style>{CSS}</style>
      <div style={{background:"#0a0500",borderBottom:"1px solid #222",padding:"3px 12px",fontSize:10,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}>
        <span style={{fontWeight:"bold",fontSize:9,letterSpacing:2}}>JR+ELDER v10</span>
        <span style={{color:"#ffaa33"}}>{clock.toTimeString().slice(0,8)}</span>
        {dayBreach&&<span style={{color:"#ff2200",fontWeight:"bold"}}>DAY LIMIT HIT</span>}
        {monBreach&&<span style={{color:"#ff0000",fontWeight:"bold"}}>MONTH LIMIT — STOP</span>}
        {todayLI&&<span style={{color:liColor(todayLI.total),fontSize:9}}>LIFE: {todayLI.total}/{liMax}</span>}
        <span style={{color:todayMood?(todayMood.score>=7?"#00cc44":"#cc2200"):"#444",fontSize:9}}>READY:{todayMood?(todayMood.score>=8?" GREEN":todayMood.score>=6?" YELLOW":" RED"):" UNLOGGED"}</span>
        {totalDeposited>0&&<span style={{color:"#00aaff",fontSize:9}}>DEP <span style={{fontWeight:"bold"}}>${totalDeposited.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</span></span>}
        {totalBonus>0&&<span style={{color:"#00ffaa",fontSize:9}}>BONUS <span style={{fontWeight:"bold"}}>${totalBonus.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0})}</span></span>}
        {netPnlDollar!==0&&<span style={{color:netPnlDollar>=0?"#00cc44":"#cc2200",fontSize:9}}>P&L {fPnl(netPnlDollar)}</span>}
        <span style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {accounts.map(a=>(<button key={a} onClick={()=>setAccount(a)} style={{padding:"1px 7px",border:"1px solid "+(a===account?"#ff8c00":"#222"),background:a===account?"#1a0800":"transparent",color:a===account?"#ff8c00":"#444",fontSize:9,cursor:"pointer",fontFamily:"monospace"}}>{a}</button>))}
          <input value={newAcc} onChange={e=>setNewAcc(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addAccount()} placeholder="+ACC" style={{width:55,padding:"1px 4px",fontSize:9}}/>
          <span style={{color:"#333"}}>WR <span style={{color:wRate(trades)>=.5?"#00cc44":"#cc2200"}}>{(wRate(trades)*100).toFixed(1)}%</span></span>
          <span style={{color:"#333"}}>R <span style={{color:totR(trades)>=0?"#00cc44":"#cc2200"}}>{f2(totR(trades))}</span></span>
        </span>
      </div>
      <div className="knav">
        {NAV.map(([id,l,k])=>(<button key={id} className={"kb"+(page===id?" on":"")} onClick={()=>setPage(id)}><span className="kb-k">{k}</span><span className="kb-l">{l}</span></button>))}
      </div>
      <div style={{padding:10,maxWidth:1200,margin:"0 auto"}}>
        {dayBreach&&<div style={{padding:"7px 12px",background:"#1a0000",border:"1px solid #660000",color:"#ff3300",fontSize:11,marginBottom:8}}>DAILY LIMIT: -{Math.abs(todayR).toFixed(2)}R — no more trades today.</div>}
        {page==="dash"      &&<Dashboard trades={trades} mood={mood} saveMood={saveMood} goals={goals} mTrades={mTrades} todayLI={todayLI} deposits={deposits}/>}
        {page==="log"       &&<TradeLog trades={trades} saveTrades={saveTrades} showToast={showToast}/>}
        {page==="check"     &&<Checklist checkLog={checkLog} saveCheckLog={saveCheckLog} showToast={showToast}/>}
        {page==="review"    &&<Review reviews={reviews} saveReviews={saveReviews} showToast={showToast}/>}
        {page==="analytics" &&<Analytics trades={trades} deposits={deposits}/>}
        {page==="goals"     &&<Goals trades={trades} goals={goals} saveGoals={saveGoals} settings={settings} saveSettings={saveSettings} showToast={showToast} mTrades={mTrades}/>}
        {page==="deposits"  &&<DepositManager deposits={deposits} saveDeposits={saveDeposits} showToast={showToast}/>}
        {page==="ai"        &&<AIReview trades={trades}/>}
        {page==="sizer"     &&<PositionSizer/>}
        {page==="htf"       &&<HTFLogger htfLog={htfLog} saveHtfLog={saveHtfLog} lifeLog={lifeLog} saveLifeLog={saveLifeLog} showToast={showToast} trades={trades}/>}
      </div>
      {toast&&<div className="toast">{toast.toUpperCase()}</div>}
    </div>
  );
}
function acKey(a){return"acc:"+a.replace(/\s+/g,"_");}

/* DASHBOARD */
function Dashboard({trades,mood,saveMood,goals,mTrades,todayLI,deposits}){
  const wins=trades.filter(t=>t.outcome==="win").length,losses=trades.filter(t=>t.outcome==="loss").length;
  const wr=(wRate(trades)*100).toFixed(1),tr=totR(trades).toFixed(2),dd=maxDD(trades).toFixed(2);
  const netPnl=trades.reduce((s,t)=>s+(+t.pnl||0)+(+t.overnightFin||0),0),ex=expectancy(trades);
  const totalDeposited=(deposits||[]).filter(d=>d.type==="Deposit").reduce((s,d)=>s+(+d.amount||0),0);
  const totalBonus=(deposits||[]).filter(d=>d.type==="Bonus").reduce((s,d)=>s+(+d.amount||0),0);
  const totalWithdrawn=(deposits||[]).filter(d=>d.type==="Withdrawal").reduce((s,d)=>s+(+d.amount||0),0);
  const netCapital=totalDeposited+totalBonus-totalWithdrawn;
  const currentBalance=netCapital+netPnl;

  const [ms,setMs]=useState(mood.find(m=>m.date===today())?.score||7);
  const moodColor=ms>=8?"#00cc44":ms>=6?"#ffaa33":"#cc2200";
  const streak=(()=>{const s=[...trades].sort((a,b)=>(a.date||"").localeCompare(b.date||""));if(!s.length)return{t:"none",n:0};const last=s[s.length-1].outcome;let c=0;for(let i=s.length-1;i>=0;i--){if(s[i].outcome===last)c++;else break;}return{t:last,n:c};})();
  const flagged=getAlerts(trades);
  return(
    <div>
      <div className="kgrid" style={{marginBottom:1}}>
        {[
          ["TRADES",trades.length,"#ff8c00"],
          ["WINS",wins,"#00cc44"],
          ["LOSSES",losses,"#cc2200"],
          ["WIN RATE",wr+"%",+wr>=50?"#00cc44":"#cc2200"],
          ["TOTAL R",f2(tr)+"R",+tr>=0?"#00cc44":"#cc2200"],
          ["EXPECT.",ex+"R",+ex>=0?"#00cc44":"#cc2200"],
          ["NET P&L",fPnl(netPnl),netPnl>=0?"#00cc44":"#cc2200"],
          ["DEPOSITED","$"+totalDeposited.toLocaleString(undefined,{minimumFractionDigits:0,maximumFractionDigits:0}),"#00aaff"],
          ["BALANCE",currentBalance>=0?"$"+currentBalance.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):"−$"+Math.abs(currentBalance).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),currentBalance>=0?"#00cc44":"#cc2200"],
          ["MAX DD",dd+"R","#cc2200"],
          ["STREAK",streak.n+(streak.t==="win"?"W":streak.t==="loss"?"L":"—"),streak.t==="win"?"#00cc44":streak.t==="loss"?"#cc2200":"#444"],
        ].map(([l,v,c])=>(<Kpi key={l} l={l} v={v} c={c}/>))}
      </div>
      <div className="g2" style={{marginBottom:1}}>
        <div className="panel"><div className="ph">EQUITY CURVE</div><Sparkline trades={trades} deposits={deposits||[]}/></div>
        <div className="panel">
          <div className="ph">OUTCOME STREAM — LAST 50</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:2}}>
            {[...trades].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).slice(-50).map((t,i)=>(<div key={i} title={t.date+" "+(t.pair||"")+" "+(t.result||0)+"R"} style={{width:10,height:10,background:t.outcome==="win"?"#00cc44":t.outcome==="loss"?"#cc2200":"#333",opacity:(t.tradingSystem==="Elder"?t.tripleScreen==="3":(t.rhType&&t.rhType!=="None"))?1:0.3,outline:t.entryType?.includes("TTE")?"1px solid #00aaff":"none"}}/>))}
          </div>
          <div style={{fontSize:9,color:"#333",marginTop:6,display:"flex",gap:12}}><span style={{color:"#00cc44"}}>WIN</span><span style={{color:"#cc2200"}}>LOSS</span><span>DIM=weak setup</span><span style={{color:"#00aaff"}}>OUTLINE=TTE</span></div>
          {(deposits||[]).length>0&&(
            <div style={{marginTop:12,borderTop:"1px solid #111",paddingTop:8}}>
              <div style={{fontSize:8,color:"#555",letterSpacing:2,marginBottom:4}}>RECENT CAPITAL EVENTS</div>
              {[...(deposits||[])].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,3).map((d,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:9,color:d.type==="Withdrawal"?"#cc4400":d.type==="Bonus"?"#00ffaa":"#00aaff",marginBottom:2}}>
                  <span>{d.date}</span>
                  <span>{d.type.toUpperCase()}</span>
                  <span>{d.type==="Withdrawal"?"-":"+"}${(+d.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="g2" style={{marginBottom:1}}>
        <div className="panel">
          <div className="ph">READINESS GATE</div>
          {todayLI&&(
            <div style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontSize:9,color:"#555",letterSpacing:1}}>LIFE INDEX TODAY</span>
                <span style={{fontSize:18,fontWeight:"bold",color:liColor(todayLI.total)}}>{todayLI.total}/{liMax}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:8}}>
                {LI_DOMAINS.map(d=>{const ds=liDomScore(d,todayLI.selections);const pct=ds/d.max*100;return(<div key={d.id}><div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#444",marginBottom:2}}><span>{d.label}</span><span style={{color:d.color}}>{ds}/{d.max}</span></div><div style={{height:3,background:"#111"}}><div style={{width:pct+"%",height:3,background:d.color}}/></div></div>);})}
              </div>
              <div style={{fontSize:10,fontWeight:"bold",color:liColor(todayLI.total),marginBottom:8,letterSpacing:1}}>{liGate(todayLI.total)}</div>
            </div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}><span style={{fontSize:28,fontWeight:"bold",color:moodColor,minWidth:28}}>{ms}</span><input type="range" min="1" max="10" value={ms} onChange={e=>setMs(+e.target.value)} style={{flex:1}}/></div>
          <div style={{fontSize:10,color:moodColor,fontWeight:"bold",marginBottom:8}}>{ms>=8?"GREEN — TRADE NORMALLY":ms>=6?"YELLOW — HALF SIZE":"RED — OBSERVE ONLY"}</div>
          <div style={{display:"flex",gap:6}}>
            <button className="btn bp" onClick={async()=>{await saveMood([{date:today(),score:ms},...mood.filter(m=>m.date!==today())].slice(0,60));}}>LOG READINESS</button>
            {todayLI&&<button className="btn" onClick={()=>setMs(Math.round(todayLI.total/liMax*10))}>USE LIFE INDEX</button>}
          </div>
        </div>
        <div className="panel">
          <div className="ph">MONTH — {monthNow()}</div>
          <GoalBar label="R EARNED" cur={totR(mTrades)} tgt={goals.monthlyR} unit="R"/>
          <GoalBar label="WIN RATE" cur={+(wRate(mTrades)*100).toFixed(1)} tgt={goals.winRate} unit="%"/>
          <GoalBar label="TRADES" cur={mTrades.length} tgt={goals.monthlyTrades} unit=""/>
        </div>
      </div>
      {flagged.length>0&&(
        <div className="panel">
          <div className="ph">AUTO-ALERTS — {flagged.length} FLAGGED</div>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {flagged.slice(0,8).map(({t,issues},i)=>(<div key={i} style={{padding:"6px 8px",background:"#0f0000",border:"1px solid #2a0000",marginBottom:4}}><div style={{display:"flex",gap:8,marginBottom:3,flexWrap:"wrap"}}><span style={{color:"#ff8c00",fontSize:10,fontWeight:"bold"}}>{t.date} {t.pair}</span><SysBadge sys={t.tradingSystem}/><span className={t.outcome} style={{fontSize:9}}>{(t.outcome||"").toUpperCase()}</span><span style={{fontSize:9,color:"#444"}}>{f2(+t.result||0)}R</span></div>{issues.map((iss,j)=>(<div key={j} style={{fontSize:9,color:"#cc4400"}}>▸ {iss}</div>))}</div>))}
          </div>
        </div>
      )}
      <div className="panel">
        <div className="ph">RECENT TRADES</div>
        {!trades.length?(<div style={{color:"#333",fontSize:10,textAlign:"center",padding:14}}>NO TRADES — GO TO LOG</div>):(
          <div style={{overflowX:"auto"}}>
            <table><thead><tr>{["#","DATE","PAIR","SYS","SES","DIR","SETUP","ENTRY","3SCR","R:R","RESULT","P&L","OVN FIN","TAGS"].map(h=><th key={h}>{h}</th>)}</tr></thead>
              <tbody>{[...trades].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,15).map((t,i)=>(
                <tr key={t.id}>
                  <td style={{color:"#333"}}>{trades.length-i}</td><td style={{color:"#555"}}>{t.date}</td>
                  <td style={{color:"#ff8c00",fontWeight:"bold"}}>{t.pair}</td>
                  <td><SysBadge sys={t.tradingSystem}/></td>
                  <td style={{color:"#555",fontSize:9}}>{(t.session||"").slice(0,3).toUpperCase()}</td>
                  <td><span className={t.direction==="Long"?"long":"short"}>{(t.direction||"").toUpperCase()}</span></td>
                  <td style={{fontSize:9,color:"#ff8c00"}}>{t.tradingSystem==="Elder"?(t.impulseSystem||"").split(" ")[0]:(t.rhType||"").replace(" Long","↑").replace(" Short","↓")}</td>
                  <td><Badge type={t.entryType}/></td>
                  <td style={{color:t.tripleScreen==="3"?"#00cc44":t.tripleScreen==="2"?"#ffaa33":"#cc2200"}}>{t.tripleScreen||"--"}/3</td>
                  <td style={{color:t.rr&&+t.rr>=2?"#00cc44":t.rr&&+t.rr>0?"#ffaa33":"#888"}}>{t.rr?t.rr+"x":"--"}</td>
                  <td><span className={t.outcome}>{f2(+t.result||0)}R</span></td>
                  <td style={{color:+t.pnl>=0?"#00cc44":"#cc2200"}}>{t.pnl?fPnl(t.pnl):"--"}</td>
                  <td style={{color:+t.overnightFin>0?"#00cc44":+t.overnightFin<0?"#cc2200":"#333"}}>{t.overnightFin?fPnl(t.overnightFin):"--"}</td>
                  <td style={{fontSize:9,color:"#555"}}>{(t.tags||"").slice(0,16)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* TRADE LOG — now with system toggle, no RSI entry fields, and foldable monthly history */
function TradeLog({trades,saveTrades,showToast}){
  const [open,setOpen]=useState(false);const[form,setForm]=useState(BLANK);const[editId,setEditId]=useState(null);
  const [fPair,setFPair]=useState("");const[fDir,setFDir]=useState("");const[fOut,setFOut]=useState("");const[fSys,setFSys]=useState("");const[fTag,setFTag]=useState("");
  const [openMonths,setOpenMonths]=useState(()=>new Set([monthKey(today())]));
  const F=(k,v)=>setForm(p=>({...p,[k]:v}));
  const hasFilter=fPair||fDir||fOut||fSys||fTag;
  const filtered=[...trades].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).filter(t=>{
    if(fPair&&!t.pair?.toUpperCase().includes(fPair.toUpperCase()))return false;
    if(fDir&&t.direction!==fDir)return false;if(fOut&&t.outcome!==fOut)return false;
    if(fSys&&t.tradingSystem!==fSys)return false;
    if(fTag&&!(t.tags||"").toLowerCase().includes(fTag.toLowerCase().replace("#","")))return false;
    return true;
  });
  const grouped=(()=>{
    const m={};
    filtered.forEach(t=>{const k=monthKey(t.date);if(!m[k])m[k]=[];m[k].push(t);});
    return Object.entries(m).sort((a,b)=>b[0].localeCompare(a[0]));
  })();
  const toggleMonth=k=>setOpenMonths(prev=>{const n=new Set(prev);n.has(k)?n.delete(k):n.add(k);return n;});

  /* Arrow-key / vim (j/k) navigation through the trade history.
     Moves a highlighted "cursor" row up/down the filtered list, auto-opening
     whichever month it lands in and scrolling it into view. Enter opens that
     trade for editing; Escape clears the cursor. Disabled while typing in any
     input/select/textarea (including the filter boxes and the entry form). */
  const [selId,setSelId]=useState(null);
  const rowRefs=useRef({});
  const selIdx=filtered.findIndex(t=>t.id===selId);
  useEffect(()=>{
    const fn=e=>{
      const tag=(document.activeElement||{}).tagName;
      if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT")return;
      if(open)return; // don't steal keys while the entry form is open
      if(!filtered.length)return;
      const key=e.key.toLowerCase();
      if(["arrowdown","j"].includes(key)){
        e.preventDefault();
        const next=selIdx<0?0:Math.min(filtered.length-1,selIdx+1);
        const t=filtered[next];
        setSelId(t.id);
        setOpenMonths(prev=>new Set(prev).add(monthKey(t.date)));
      }else if(["arrowup","k"].includes(key)){
        e.preventDefault();
        const prevIdx=selIdx<0?0:Math.max(0,selIdx-1);
        const t=filtered[prevIdx];
        setSelId(t.id);
        setOpenMonths(prev=>new Set(prev).add(monthKey(t.date)));
      }else if(key==="enter"&&selId!=null){
        const t=filtered.find(x=>x.id===selId);
        if(t){setForm({...BLANK,...t});setEditId(t.id);setOpen(true);}
      }else if(key==="escape"){
        setSelId(null);
      }
    };
    window.addEventListener("keydown",fn);
    return()=>window.removeEventListener("keydown",fn);
  },[filtered,selIdx,selId,open]);
  useEffect(()=>{
    if(selId!=null&&rowRefs.current[selId]){
      rowRefs.current[selId].scrollIntoView({block:"nearest",behavior:"smooth"});
    }
  },[selId]);

  const sysVal=form.tradingSystem;
  const showRoss=sysVal==="Joe Ross"||sysVal==="Hybrid";
  const showElder=sysVal==="Elder"||sysVal==="Hybrid";
  const autoRR=()=>{const e=+form.entry,s=+form.sl,t=+form.tp;if(e&&s&&t)return(Math.abs(t-e)/Math.abs(e-s)).toFixed(2);return"";};
  const computedForm={...form,rr:autoRR()||form.rr};
  const QF=qfFor(computedForm);
  const qScore=autoQ(computedForm),qColor=qScore>=4?"#00cc44":qScore>=3?"#ffaa33":"#cc2200";
  const qLabel=qScore===5?"EXCELLENT — FULL SIZE":qScore===4?"GOOD — STANDARD SIZE":qScore===3?"MARGINAL — HALF SIZE OR SKIP":qScore===2?"WEAK — SKIP":qScore<=1?"INVALID — DO NOT TRADE":"";

  const importCSV=async e=>{
    const file=e.target.files[0];if(!file)return;
    const text=await file.text();
    const lines=text.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2){showToast("EMPTY FILE");return;}
    const parseRow=row=>{const vals=[];let cur="",inQ=false;for(const ch of row){if(ch==='"'){inQ=!inQ;}else if(ch===","&&!inQ){vals.push(cur);cur="";}else{cur+=ch;}}vals.push(cur);return vals.map(v=>v.replace(/^"|"$/g,""));};
    const headers=parseRow(lines[0]).map(h=>h.trim());
    const imported=lines.slice(1).map(line=>{
      const vals=parseRow(line);
      const obj={};
      headers.forEach((h,i)=>{obj[h]=vals[i]??""});
      if(!obj.pair?.trim())return null;
      const merged={...BLANK,...obj,id:Date.now()+Math.random(),outcome:getOut(obj.result)};
      merged.entryQuality=String(autoQ(merged));
      return merged;
    }).filter(Boolean);
    if(!imported.length){showToast("NO VALID ROWS");e.target.value="";return;}
    await saveTrades([...trades,...imported]);
    showToast("IMPORTED "+imported.length+" TRADES");
    e.target.value="";
  };

  const handleSave=async()=>{
    if(!form.pair.trim()){showToast("ENTER PAIR");return;}
    if(sysVal==="Hybrid"&&!form.entryThesis.trim()){showToast("HYBRID REQUIRES AN ENTRY THESIS");return;}
    const t={...form,pair:form.pair.toUpperCase(),id:editId||(Date.now()+Math.random()),outcome:getOut(form.result),rr:autoRR()||form.rr,entryQuality:String(qScore)};
    await saveTrades(editId?trades.map(x=>x.id===editId?t:x):[t,...trades]);
    setForm(BLANK);setOpen(false);setEditId(null);showToast(editId?"UPDATED":"SAVED");
    setOpenMonths(prev=>new Set(prev).add(monthKey(t.date)));
  };

  return(
    <div>
      <div className="panel"><div style={{display:"flex",gap:8,alignItems:"center"}}><span className="ph" style={{marginBottom:0,flex:1}}>TRADE ENTRY</span><button className={"btn"+(open?" bp":"")} onClick={()=>{setOpen(o=>!o);setEditId(null);setForm(BLANK);}}>{open?"CANCEL":"+ ADD TRADE"}</button><button className="btn" onClick={()=>doCSV(trades)}>EXPORT CSV</button><label className="btn" style={{cursor:"pointer",display:"inline-block"}}>IMPORT CSV<input type="file" accept=".csv" style={{display:"none"}} onChange={importCSV}/></label></div></div>
      {open&&(
        <div className="panel">
          <div className="ph">{editId?"EDIT TRADE":"NEW TRADE"}</div>
          <div className="sec">TRADING SYSTEM</div>
          <div style={{display:"flex",gap:4,marginBottom:8}}>
            {SYSTEMS.map(s=>(<button key={s} className={"esel"+(form.tradingSystem===s?" on":"")} onClick={()=>F("tradingSystem",s)}>{s.toUpperCase()}</button>))}
          </div>
          <div style={{marginBottom:10}}>
            <label className="fl">ENTRY THESIS — what actually caused this entry?</label>
            <input value={form.entryThesis} onChange={e=>F("entryThesis",e.target.value)} placeholder={sysVal==="Hybrid"?"Required for Hybrid: name the Elder condition AND the Ross trigger that both had to hold":sysVal==="Elder"?"e.g. Daily trend + H4 pullback into value zone + momentum confirm":"e.g. 1-2-3 formed, Ross Hook broke, entered on TTE"}/>
            {sysVal==="Hybrid"&&!form.entryThesis.trim()&&<div style={{fontSize:9,color:"#cc2200",marginTop:3}}>Required — this won't save as Hybrid until filled in.</div>}
          </div>
          {sysVal==="Hybrid"&&(
            <div style={{marginBottom:10,padding:"8px 10px",background:"#0a0a0a",border:"1px solid #1a1a1a"}}>
              <div className="fl" style={{marginBottom:6}}>HYBRID HONESTY CHECK — answer honestly, not retroactively</div>
              {[["wouldTakeRossAlone","Would you have taken this trade on the Ross structure alone, with no Elder confirmation?"],
                ["wouldTakeElderAlone","Would you have taken this trade on the Elder conditions alone, with no Ross structure?"]].map(([k,q])=>(
                <div key={k} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0"}}>
                  <span style={{fontSize:10,color:"#888",flex:1}}>{q}</span>
                  <div style={{display:"flex",gap:4}}>
                    {["Yes","No"].map(v=>(<button key={v} className={"esel"+(form[k]===v?" on":"")} onClick={()=>F(k,v)} style={{padding:"2px 10px"}}>{v}</button>))}
                  </div>
                </div>
              ))}
              {(form.wouldTakeRossAlone==="Yes"||form.wouldTakeElderAlone==="Yes")&&(
                <div style={{fontSize:9,color:"#cc2200",marginTop:6}}>
                  ⚠ If either answer is Yes, this trade wasn't actually dependent on both conditions — it's really a {form.wouldTakeRossAlone==="Yes"?"Joe Ross":"Elder"} trade with incidental overlap, not Hybrid. Consider relabeling it to keep the Hybrid bucket clean.
                </div>
              )}
            </div>
          )}
          <div className="frow">
            <div><label className="fl">DATE</label><input type="date" value={form.date} onChange={e=>F("date",e.target.value)}/></div>
            <div><label className="fl">PAIR</label><input value={form.pair} onChange={e=>F("pair",e.target.value)} placeholder="EURUSD"/></div>
            <div><label className="fl">SESSION</label><select value={form.session} onChange={e=>F("session",e.target.value)}>{SESSIONS.map(o=><option key={o}>{o}</option>)}</select></div>
            <div><label className="fl">TIMEFRAME</label><select value={form.timeframe} onChange={e=>F("timeframe",e.target.value)}>{TFS.map(o=><option key={o}>{o}</option>)}</select></div>
            <div><label className="fl">DIRECTION</label><select value={form.direction} onChange={e=>F("direction",e.target.value)}><option>Long</option><option>Short</option></select></div>
            <div><label className="fl">HTF BIAS</label><select value={form.htf} onChange={e=>F("htf",e.target.value)}><option>Bullish</option><option>Bearish</option><option>Neutral</option></select></div>
          </div>

          {showRoss&&(<>
            <div className="sec">ROSS STRUCTURE{sysVal==="Hybrid"?" (required for Hybrid)":""}</div>
            <div className="frow">
              <div style={{gridColumn:"span 2"}}><label className="fl">Rh TYPE</label><select value={form.rhType} onChange={e=>F("rhType",e.target.value)}>{RH_TYPES.map(o=><option key={o}>{o}</option>)}</select></div>
              <div><label className="fl">PIVOT WIDTH</label><select value={form.pivotWidth} onChange={e=>F("pivotWidth",e.target.value)}>{PIVOT_W.map(o=><option key={o}>{o}</option>)}</select></div>
              <div><label className="fl">ATTEMPT</label><select value={form.attempt} onChange={e=>F("attempt",e.target.value)}>{ATTEMPTS.map(o=><option key={o}>{o}</option>)}</select></div>
            </div>
            <div className="sec">ENTRY TYPE</div>
            <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>{ENTRY_T.map(t=>(<button key={t} className={"esel"+(form.entryType===t?" on":"")} onClick={()=>F("entryType",t)}>{t.includes("TTE")?"TTE":t.includes("Pull")?"PULLBACK":"STANDARD"}</button>))}</div>
          </>)}

          {showElder&&(<>
            <div className="sec">ELDER TREND / VALUE / MOMENTUM{sysVal==="Hybrid"?" (required for Hybrid)":""}</div>
            <div className="frow">
              <div><label className="fl">MA CROSSOVER</label><select value={form.maCross} onChange={e=>F("maCross",e.target.value)}>{MA_CROSS.map(o=><option key={o}>{o}</option>)}</select></div>
              <div><label className="fl">VALUE ZONE</label><select value={form.valueZone} onChange={e=>F("valueZone",e.target.value)}>{VALUE_ZONE.map(o=><option key={o}>{o}</option>)}</select></div>
              <div><label className="fl">IMPULSE SYSTEM</label><select value={form.impulseSystem} onChange={e=>F("impulseSystem",e.target.value)}>{IMPULSE.map(o=><option key={o}>{o}</option>)}</select></div>
              <div><label className="fl">DIVERGENCE (EXIT WARNING)</label><select value={form.divergence} onChange={e=>F("divergence",e.target.value)}>{DIVERGENCE.map(o=><option key={o}>{o}</option>)}</select></div>
            </div>
          </>)}

          <div className="sec">TRIPLE SCREEN ALIGNMENT</div>
          <div className="frow">
            <div><label className="fl">SCREENS ALIGNED</label><select value={form.tripleScreen} onChange={e=>F("tripleScreen",e.target.value)}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
          </div>

          <div className="sec">ENTRY QUALITY — AUTO-SCORED ({sysVal.toUpperCase()} CRITERIA)</div>
          <div style={{marginBottom:10}}>
            {QF.map((qf,i)=>{const ok=qf.auto(computedForm);return(<div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid #0f0f0f"}}><div style={{width:11,height:11,background:ok?"#ff8c00":"#111",border:"1px solid "+(ok?"#ff8c00":"#333"),flexShrink:0}}/><span style={{fontSize:9,color:ok?"#ff8c00":"#444",flex:1}}>{qf.text}</span></div>);})}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0 4px"}}><span style={{fontSize:11,fontWeight:"bold",color:qColor}}>{qScore}/5 — {qLabel}</span><div style={{width:80,height:4,background:"#111"}}><div style={{width:(qScore/5*100)+"%",height:4,background:qColor}}/></div></div>
          </div>
          <div className="sec">EXECUTION & NUMBERS</div>
          <div className="frow">
            {[["entry","ENTRY"],["sl","STOP"],["tp","TAKE PROFIT"],["exitPrice","EXIT PRICE (if ≠ TP)"],["result","RESULT (R)"],["pnl","P&L ($)"]].map(([k,l])=>(<div key={k}><label className="fl">{l}</label><input type="number" step="any" value={form[k]} onChange={e=>F(k,e.target.value)}/></div>))}
            <div><label className="fl">R:R (AUTO)</label><input readOnly value={autoRR()} style={{color:"#555"}} placeholder="auto"/></div>
            <div>
              <label className="fl">EXIT REASON</label>
              <select value={form.exitReason} onChange={e=>F("exitReason",e.target.value)}>
                <option value="">--</option>
                {EXIT_REASONS.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="fl">OVERNIGHT FIN ($)</label>
              <input type="number" step="any" value={form.overnightFin} onChange={e=>F("overnightFin",e.target.value)} placeholder="neg = charge, pos = credit"/>
            </div>
          </div>
          {(form.pnl||form.overnightFin)&&(
            <div style={{padding:"5px 10px",background:"#080808",border:"1px solid #1a1a1a",marginBottom:8,fontSize:9,display:"flex",gap:20}}>
              <span>P&L <span style={{color:+form.pnl>=0?"#00cc44":"#cc2200"}}>{form.pnl?fPnl(+form.pnl):"--"}</span></span>
              {form.overnightFin&&<span>OVN FIN <span style={{color:+form.overnightFin>=0?"#00cc44":"#cc2200"}}>{fPnl(+form.overnightFin)}</span></span>}
              {form.pnl&&form.overnightFin&&<span style={{fontWeight:"bold"}}>NET <span style={{color:(+form.pnl+(+form.overnightFin||0))>=0?"#00cc44":"#cc2200"}}>{fPnl(+form.pnl+(+form.overnightFin||0))}</span></span>}
            </div>
          )}
          <div className="frow">
            {[["volatility","VOLATILITY",["Low","Normal","High"]],["newsImpact","NEWS",["None","Yellow","Orange","Red"]],["rules","RULES",["Yes","Partial","No"]]].map(([k,l,opts])=>(<div key={k}><label className="fl">{l}</label><select value={form[k]} onChange={e=>F(k,e.target.value)}>{opts.map(o=><option key={o}>{o}</option>)}</select></div>))}
          </div>
          <div style={{marginBottom:8}}><label className="fl" style={{marginBottom:4}}>EMOTION PRE</label><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{EMO.map(e=>(<button key={e} className={"esel"+(form.emoPre===e?" on":"")} onClick={()=>F("emoPre",e)}>{e.toUpperCase()}</button>))}</div></div>
          <div style={{marginBottom:8}}><label className="fl" style={{marginBottom:4}}>EMOTION POST</label><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{EMO_POST.map(e=>(<button key={e} className={"esel"+(form.emoPost===e?" on":"")} onClick={()=>F("emoPost",e)}>{e.toUpperCase()}</button>))}</div></div>
          <div className="frow">
            <div><label className="fl">TAGS</label><input value={form.tags} onChange={e=>F("tags",e.target.value)} placeholder="#tte #ledge #elder"/></div>
            <div><label className="fl">CHART URL (PRE-TRADE)</label><input value={form.chartUrl||""} onChange={e=>F("chartUrl",e.target.value)} placeholder="https://www.tradingview.com/..."/></div>
            <div><label className="fl">CHART URL (DAILY — FILTER SCREEN)</label><input value={form.chartDaily||""} onChange={e=>F("chartDaily",e.target.value)} placeholder="https://www.tradingview.com/..."/></div>
            <div><label className="fl">CHART URL (POST-TRADE)</label><input value={form.chartPost||""} onChange={e=>F("chartPost",e.target.value)} placeholder="annotated after close"/></div>
          </div>
          <div style={{marginBottom:10}}><label className="fl">NOTES</label><textarea value={form.notes} onChange={e=>F("notes",e.target.value)}/></div>
          <div style={{display:"flex",gap:6}}><button className="btn bp" onClick={handleSave}>{editId?"UPDATE":"SAVE"}</button><button className="btn" onClick={()=>{setOpen(false);setEditId(null);setForm(BLANK);}}>CANCEL</button></div>
        </div>
      )}
      <div className="panel">
        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
          <span className="ph" style={{marginBottom:0,flex:1}}>HISTORY — {filtered.length}{hasFilter?" (filtered)":""} / {trades.length}</span>
          <input value={fPair} onChange={e=>setFPair(e.target.value)} placeholder="Pair…" style={{width:72}}/>
          <select value={fDir} onChange={e=>setFDir(e.target.value)} style={{width:"auto",fontSize:10}}><option value="">ALL DIR</option><option>Long</option><option>Short</option></select>
          <select value={fOut} onChange={e=>setFOut(e.target.value)} style={{width:"auto",fontSize:10}}><option value="">ALL</option><option value="win">WIN</option><option value="loss">LOSS</option><option value="be">B/E</option></select>
          <select value={fSys} onChange={e=>setFSys(e.target.value)} style={{width:"auto",fontSize:10}}><option value="">ALL SYS</option>{SYSTEMS.map(s=><option key={s}>{s}</option>)}</select>
          <input value={fTag} onChange={e=>setFTag(e.target.value)} placeholder="#tag…" style={{width:72}}/>
          {hasFilter&&<button className="btn" onClick={()=>{setFPair("");setFDir("");setFOut("");setFSys("");setFTag("");}}>CLEAR</button>}
          {grouped.length>1&&<button className="btn" onClick={()=>setOpenMonths(new Set(grouped.map(([k])=>k)))}>EXPAND ALL</button>}
          {grouped.length>1&&<button className="btn" onClick={()=>setOpenMonths(new Set())}>COLLAPSE ALL</button>}
        </div>
        {!!filtered.length&&<div style={{fontSize:8,color:"#333",letterSpacing:1,marginBottom:6}}>↑↓ / J K to move · ENTER to edit · ESC to clear — disabled while a filter box or the entry form is focused</div>}
        {!trades.length?(<div style={{color:"#333",fontSize:10,textAlign:"center",padding:14}}>NO TRADES</div>):!filtered.length?(<div style={{color:"#555",fontSize:10,textAlign:"center",padding:14}}>NO TRADES MATCH FILTER</div>):(
          <div>
            {grouped.map(([mk,arr])=>{
              const isOpen=openMonths.has(mk);
              const mWr=(wRate(arr)*100).toFixed(0),mR=totR(arr).toFixed(2);
              return(
                <div key={mk} style={{marginBottom:1}}>
                  <div className="mhead" onClick={()=>toggleMonth(mk)}>
                    <span className="mcaret">{isOpen?"▾":"▸"}</span>
                    <span style={{color:"#ff8c00",fontWeight:"bold",fontSize:10,letterSpacing:1}}>{monthLabel(mk)}</span>
                    <span style={{color:"#555",fontSize:9}}>{arr.length} trades</span>
                    <span style={{color:+mWr>=50?"#00cc44":"#cc2200",fontSize:9}}>{mWr}% WR</span>
                    <span style={{color:+mR>=0?"#00cc44":"#cc2200",fontSize:9,marginLeft:"auto"}}>{f2(mR)}R</span>
                  </div>
                  {isOpen&&(
                    <div style={{overflowX:"auto"}}>
                      <table><thead><tr>{["#","DATE","PAIR","SYS","TF","DIR","SETUP","ENTRY","Q/5","3SCR","R:R","RESULT","P&L","OVN FIN","NET P&L","EXIT REASON","VOL","NEWS","RULES","TAGS",""].map(h=><th key={h}>{h}</th>)}</tr></thead>
                        <tbody>{arr.map((t,i)=>{const net=(+t.pnl||0)+(+t.overnightFin||0);const isSel=t.id===selId;return(
                          <tr key={t.id} ref={el=>{rowRefs.current[t.id]=el;}} onClick={()=>setSelId(t.id)}
                            style={isSel?{background:"#1a0f00",outline:"1px solid #ff8c00",outlineOffset:"-1px",cursor:"pointer"}:{cursor:"pointer"}}>
                            <td style={{color:isSel?"#ff8c00":"#333"}}>{isSel?"▸":arr.length-i}</td><td style={{color:"#555"}}>{t.date}</td>
                            <td style={{color:"#ff8c00",fontWeight:"bold"}}>{t.pair}</td>
                            <td><SysBadge sys={t.tradingSystem}/></td>
                            <td style={{color:"#444"}}>{t.timeframe}</td>
                            <td><span className={t.direction==="Long"?"long":"short"}>{(t.direction||"").toUpperCase()}</span></td>
                            <td style={{fontSize:9,color:"#ff8c00"}}>{t.tradingSystem==="Elder"?(t.impulseSystem||"").split(" ")[0]:(t.rhType||"").replace(" Long","↑").replace(" Short","↓")}</td>
                            <td><Badge type={t.entryType}/></td>
                            <td style={{color:autoQ(t)>=4?"#00cc44":autoQ(t)>=3?"#ffaa33":"#cc2200"}}>{autoQ(t)}</td>
                            <td style={{color:t.tripleScreen==="3"?"#00cc44":t.tripleScreen==="2"?"#ffaa33":"#cc2200"}}>{t.tripleScreen||"--"}/3</td>
                            <td style={{color:t.rr&&+t.rr>=2?"#00cc44":t.rr&&+t.rr>0?"#ffaa33":"#888"}}>{t.rr?t.rr+"x":"--"}</td>
                            <td><span className={t.outcome}>{f2(+t.result||0)}R</span></td>
                            <td style={{color:+t.pnl>=0?"#00cc44":"#cc2200"}}>{t.pnl?fPnl(t.pnl):"--"}</td>
                            <td style={{color:+t.overnightFin>0?"#00cc44":+t.overnightFin<0?"#cc2200":"#333"}}>{t.overnightFin?fPnl(+t.overnightFin):"--"}</td>
                            <td style={{color:net>=0?"#00cc44":"#cc2200",fontWeight:t.overnightFin?"bold":"normal"}}>{(t.pnl||t.overnightFin)?fPnl(net):"--"}</td>
                            <td style={{fontSize:9,color:t.exitReason?"#ff8c00":"#333"}}>{t.exitReason||"--"}</td>
                            <td style={{fontSize:9,color:t.volatility==="High"?"#cc2200":t.volatility==="Low"?"#555":"#888"}}>{t.volatility||"--"}</td>
                            <td style={{fontSize:9,color:t.newsImpact==="Red"?"#cc2200":t.newsImpact==="Orange"?"#ff8c00":t.newsImpact==="Yellow"?"#ffaa33":"#333"}}>{t.newsImpact||"--"}</td>
                            <td style={{color:t.rules==="Yes"?"#00cc44":t.rules==="Partial"?"#ffaa33":"#cc2200"}}>{t.rules}</td>
                            <td style={{fontSize:9,color:"#555",maxWidth:80,overflow:"hidden",textOverflow:"ellipsis"}}>{(t.tags||"").slice(0,16)}</td>
                            <td><div style={{display:"flex",gap:3}}><button className="btn" style={{padding:"1px 5px",fontSize:9}} onClick={()=>{setForm({...BLANK,...t});setEditId(t.id);setOpen(true);}}>EDIT</button><button className="btn bd" onClick={async()=>{await saveTrades(trades.filter(x=>x.id!==t.id));showToast("DELETED");}}>DEL</button></div></td>
                          </tr>
                        );})}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* CHECKLIST — system-aware */
function Checklist({checkLog,saveCheckLog,showToast}){
  const [sys,setSys]=useState("Joe Ross");
  const CHECKS=sys==="Elder"?CHECKS_ELDER:sys==="Hybrid"?[...CHECKS_ROSS,...CHECKS_ELDER.filter(c=>c.sec.startsWith("SCREEN")||c.sec.startsWith("IMPULSE")||c.sec.startsWith("VALUE")||c.sec.startsWith("EXIT"))]:CHECKS_ROSS;
  const [chks,setChks]=useState({});
  const tot=CHECKS.length,cnt=CHECKS.filter(c=>chks[c.id]).length,pct=Math.round(cnt/tot*100);
  const vColor=cnt===tot?"#00cc44":cnt>=tot-3?"#ffaa33":"#cc2200";
  const verdict=cnt===tot?"CONFIRMED — EXECUTE":cnt>=tot-3?"BORDERLINE — REVIEW":"DO NOT TRADE";
  const secs=[...new Set(CHECKS.map(c=>c.sec))];
  return(
    <div className="g2" style={{alignItems:"start"}}>
      <div className="panel">
        <div className="ph">PRE-TRADE CHECKLIST</div>
        <div style={{display:"flex",gap:4,marginBottom:10}}>
          {SYSTEMS.map(s=>(<button key={s} className={"esel"+(sys===s?" on":"")} onClick={()=>{setSys(s);setChks({});}}>{s.toUpperCase()}</button>))}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:11,fontWeight:"bold",color:vColor}}>{verdict}</span><span style={{fontSize:10,color:"#555"}}>{cnt}/{tot}</span></div>
        <div style={{height:4,background:"#111",marginBottom:12}}><div style={{width:pct+"%",height:4,background:vColor,transition:"width .3s"}}/></div>
        {secs.map(sec=>(<div key={sec} style={{marginBottom:12}}><div className="sec">{sec}</div>{CHECKS.filter(c=>c.sec===sec).map(c=>(<div key={c.id} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:"1px solid #0f0f0f"}}><input type="checkbox" checked={!!chks[c.id]} onChange={e=>setChks(p=>({...p,[c.id]:e.target.checked}))} style={{width:12,height:12,accentColor:"#ff8c00",flexShrink:0,marginTop:2}}/><span style={{fontSize:11,color:chks[c.id]?"#ff8c00":"#555"}}>{c.text}</span></div>))}</div>))}
        <div style={{display:"flex",gap:6,marginTop:8}}><button className="btn bp" onClick={async()=>{await saveCheckLog([{date:today(),time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),score:cnt,total:tot,sys},...checkLog].slice(0,100));showToast("LOGGED "+cnt+"/"+tot);}}>LOG</button><button className="btn" onClick={()=>setChks({})}>RESET</button></div>
      </div>
      <div className="panel">
        <div className="ph">HISTORY</div>
        {!checkLog.length?<div style={{color:"#333",fontSize:10}}>NO HISTORY</div>:checkLog.slice(0,20).map((c,i)=>{const p=Math.round(c.score/(c.total||12)*100),col=c.score===(c.total||12)?"#00cc44":c.score>=(c.total||12)-3?"#ffaa33":"#cc2200";return(<div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #0f0f0f"}}><span style={{fontSize:9,color:"#444",minWidth:40}}>{c.sys==="Elder"?"ELD":"JR"}</span><span style={{fontSize:10,color:"#444",minWidth:110}}>{c.date} {c.time}</span><div style={{flex:1,height:3,background:"#111"}}><div style={{width:p+"%",height:"100%",background:col}}/></div><span style={{fontSize:10,color:col,minWidth:30,textAlign:"right"}}>{c.score}/{c.total||12}</span></div>);})}
      </div>
    </div>
  );
}

/* REVIEW */
function Review({reviews,saveReviews,showToast}){
  const [tab,setTab]=useState("daily");
  const [daily,setDaily]=useState({date:today(),vol:"Medium",best:"",mistakes:"",discipline:"Yes"});
  const [weekly,setWeekly]=useState({date:today(),bestSetup:"",lesson:"",avoid:""});
  return(
    <div>
      <div className="tabrow">{["daily","weekly"].map(t=>(<button key={t} className={"tb"+(tab===t?" on":"")} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>))}</div>
      {tab==="daily"&&(<div className="g2" style={{alignItems:"start"}}>
        <div className="panel"><div className="ph">DAILY REVIEW</div>
          <div className="frow">
            <div><label className="fl">DATE</label><input type="date" value={daily.date} onChange={e=>setDaily(p=>({...p,date:e.target.value}))}/></div>
            <div><label className="fl">VOLATILITY</label><select value={daily.vol} onChange={e=>setDaily(p=>({...p,vol:e.target.value}))}>{["Low","Medium","High"].map(o=><option key={o}>{o}</option>)}</select></div>
            <div><label className="fl">DISCIPLINE</label><select value={daily.discipline} onChange={e=>setDaily(p=>({...p,discipline:e.target.value}))}>{["Yes","Mostly","No"].map(o=><option key={o}>{o}</option>)}</select></div>
          </div>
          {[["best","BEST SETUP"],["mistakes","MISTAKES — EARLY ENTRY? FOMO?"]].map(([k,l])=>(<div key={k} style={{marginBottom:8}}><label className="fl">{l}</label><textarea value={daily[k]||""} onChange={e=>setDaily(p=>({...p,[k]:e.target.value}))}/></div>))}
          <button className="btn bp" onClick={async()=>{await saveReviews({...reviews,daily:[daily,...reviews.daily].slice(0,60)});showToast("SAVED");}}>SAVE</button>
        </div>
        <div className="panel"><div className="ph">HISTORY</div>{!reviews.daily.length?<div style={{color:"#333",fontSize:10}}>NO ENTRIES</div>:reviews.daily.slice(0,12).map((r,i)=>(<div key={i} style={{padding:"7px 0",borderBottom:"1px solid #111"}}><div style={{display:"flex",gap:8,marginBottom:2}}><span style={{color:"#ff8c00",fontSize:10}}>{r.date}</span><span style={{fontSize:9,color:r.discipline==="Yes"?"#00cc44":"#cc2200"}}>{r.discipline}</span></div>{r.best&&<div style={{fontSize:10,color:"#888"}}>{r.best.slice(0,100)}</div>}{r.mistakes&&<div style={{fontSize:10,color:"#cc2200"}}>{r.mistakes.slice(0,80)}</div>}</div>))}</div>
      </div>)}
      {tab==="weekly"&&(<div className="g2" style={{alignItems:"start"}}>
        <div className="panel"><div className="ph">WEEKLY REVIEW</div>
          <div className="frow"><div><label className="fl">WEEK OF</label><input type="date" value={weekly.date} onChange={e=>setWeekly(p=>({...p,date:e.target.value}))}/></div></div>
          {[["bestSetup","BEST SETUP / ENTRY TYPE"],["lesson","KEY LESSON"],["avoid","CONDITIONS TO AVOID"]].map(([k,l])=>(<div key={k} style={{marginBottom:8}}><label className="fl">{l}</label><textarea value={weekly[k]||""} onChange={e=>setWeekly(p=>({...p,[k]:e.target.value}))}/></div>))}
          <button className="btn bp" onClick={async()=>{await saveReviews({...reviews,weekly:[weekly,...reviews.weekly].slice(0,30)});showToast("SAVED");}}>SAVE</button>
        </div>
        <div className="panel"><div className="ph">HISTORY</div>{!reviews.weekly.length?<div style={{color:"#333",fontSize:10}}>NO ENTRIES</div>:reviews.weekly.slice(0,8).map((r,i)=>(<div key={i} style={{padding:"7px 0",borderBottom:"1px solid #111"}}><div style={{color:"#ff8c00",fontSize:10,marginBottom:2}}>WEEK OF {r.date}</div>{r.lesson&&<div style={{fontSize:10,color:"#888"}}>{r.lesson.slice(0,100)}</div>}</div>))}</div>
      </div>)}
    </div>
  );
}

/* ANALYTICS */
function RollingExpectancy({trades,n=20}){
  const sorted=[...trades].sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  if(sorted.length<n+1)return(<div className="panel"><div className="ph">ROLLING {n}-TRADE EXPECTANCY</div><div style={{color:"#333",fontSize:10,textAlign:"center",padding:20}}>Need {n+1}+ trades — have {sorted.length}</div></div>);
  const pts=sorted.map((_,i)=>{if(i<n-1)return null;return +expectancy(sorted.slice(i-n+1,i+1));}).filter(v=>v!==null);
  const W=540,H=100,pad=6,mn=Math.min(...pts,0),mx=Math.max(...pts,0),rng=mx-mn||1;
  const sx=i=>pad+i/(pts.length-1)*(W-pad*2),sy=v=>pad+(mx-v)/rng*(H-pad*2),zero=sy(0);
  const last=pts[pts.length-1],avg=(pts.reduce((s,v)=>s+v,0)/pts.length).toFixed(3);
  const trend=pts.length>=10?(pts.slice(-5).reduce((s,v)=>s+v,0)/5-pts.slice(-10,-5).reduce((s,v)=>s+v,0)/5).toFixed(3):null;
  return(
    <div className="panel">
      <div className="ph">ROLLING {n}-TRADE EXPECTANCY</div>
      <div style={{display:"flex",gap:20,marginBottom:10,flexWrap:"wrap"}}>
        <div><div style={{fontSize:9,color:"#555",marginBottom:2}}>CURRENT</div><div style={{fontSize:22,fontWeight:"bold",color:last>=0?"#00cc44":"#cc2200"}}>{last>=0?"+":""}{last.toFixed(3)}R</div></div>
        <div><div style={{fontSize:9,color:"#555",marginBottom:2}}>AVERAGE</div><div style={{fontSize:22,fontWeight:"bold",color:+avg>=0?"#00cc44":"#cc2200"}}>{+avg>=0?"+":""}{avg}R</div></div>
        {trend&&<div><div style={{fontSize:9,color:"#555",marginBottom:2}}>5-TRADE TREND</div><div style={{fontSize:22,fontWeight:"bold",color:+trend>=0?"#00cc44":"#cc2200"}}>{+trend>=0?"↑":"↓"} {Math.abs(+trend).toFixed(3)}</div></div>}
      </div>
      <svg width={W} height={H}>
        <line x1={pad} y1={zero} x2={W-pad} y2={zero} stroke="#222" strokeDasharray="3,3"/>
        <text x={W-pad} y={zero-3} textAnchor="end" fill="#333" fontSize="8" fontFamily="Courier New">0</text>
        {pts.map((v,i)=>i===0?null:(<line key={i} x1={sx(i-1)} y1={sy(pts[i-1])} x2={sx(i)} y2={sy(v)} stroke={v>=0&&pts[i-1]>=0?"#00cc44":v<0&&pts[i-1]<0?"#cc2200":"#888"} strokeWidth="2"/>))}
        <circle cx={sx(pts.length-1)} cy={sy(last)} r="4" fill={last>=0?"#00cc44":"#cc2200"}/>
      </svg>
      <div style={{fontSize:9,color:"#333",marginTop:6}}>Each point = expectancy of last {n} trades. Rising = edge improving. Falling = review system.</div>
    </div>
  );
}
function Analytics({trades, deposits}){
  const [tab,setTab]=useState("overview");
  const mkBD=(keys,fn)=>keys.map(k=>{const arr=trades.filter(t=>fn(t)===k),w=arr.filter(t=>t.outcome==="win").length;return{label:k,n:arr.length,wr:arr.length?(w/arr.length*100).toFixed(0):null,r:totR(arr).toFixed(2)};}).filter(x=>x.n>0);
  const DAYS=["MON","TUE","WED","THU","FRI"],MNTHS=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const dayArr=i=>trades.filter(t=>{if(!t.date)return false;const d=new Date(t.date+"T12:00:00").getDay();return(d===0?6:d-1)===i;});
  const mthArr=i=>trades.filter(t=>t.date&&new Date(t.date+"T12:00:00").getMonth()===i);
  const years=[...new Set(trades.map(t=>t.date?.slice(0,4)).filter(Boolean))].sort();
  const getWeeks=()=>{const m={};trades.forEach(t=>{if(!t.date)return;const d=new Date(t.date+"T12:00:00"),dy=d.getDay(),diff=d.getDate()-dy+(dy===0?-6:1),ws=new Date(new Date(d).setDate(diff)).toISOString().slice(0,10);if(!m[ws])m[ws]=[];m[ws].push(t);});return Object.entries(m).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,12).reverse();};
  const rulesData=["Yes","Partial","No"].map(v=>{const arr=trades.filter(t=>t.rules===v),w=arr.filter(t=>t.outcome==="win").length;return{label:v==="Yes"?"FOLLOWED":v==="Partial"?"PARTIAL":"BROKEN",n:arr.length,wr:arr.length?(w/arr.length*100).toFixed(1):null,r:totR(arr).toFixed(2),color:v==="Yes"?"#00cc44":v==="Partial"?"#ffaa33":"#cc2200"};});
  const monthMap={};trades.forEach(t=>{if(!t.date)return;const m=t.date.slice(0,7);if(!monthMap[m])monthMap[m]={n:0,w:0,r:0,pnl:0};monthMap[m].n++;if(t.outcome==="win")monthMap[m].w++;monthMap[m].r+=+t.result||0;monthMap[m].pnl+=(+t.pnl||0)+(+t.overnightFin||0);});
  const bySystem=mkBD(SYSTEMS,t=>t.tradingSystem);
  const TABS=[["overview","OVERVIEW"],["system","BY SYSTEM"],["heatmap","HEATMAP"],["rules","RULES"],["exits","EXITS"],["rolling","ROLLING EXP"]];
  return(
    <div>
      <div className="tabrow">{TABS.map(([id,l])=>(<button key={id} className={"tb"+(tab===id?" on":"")} onClick={()=>setTab(id)}>{l}</button>))}</div>
      {tab==="overview"&&(<div><div className="panel" style={{marginBottom:1}}><div className="ph">BY SESSION</div><BT rows={mkBD(SESSIONS,t=>t.session)}/></div><div className="panel" style={{marginBottom:1}}><div className="ph">EQUITY CURVE</div><Sparkline trades={trades} deposits={deposits||[]}/></div><div className="panel"><div className="ph">MONTHLY</div><table><thead><tr>{["MONTH","N","WIN%","TOTAL R","NET P&L"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{Object.entries(monthMap).sort((a,b)=>b[0].localeCompare(a[0])).map(([m,d])=>(<tr key={m}><td style={{color:"#ff8c00",fontWeight:"bold"}}>{m}</td><td>{d.n}</td><td style={{color:d.n&&d.w/d.n>=.5?"#00cc44":"#cc2200"}}>{d.n?(d.w/d.n*100).toFixed(0)+"%":"--"}</td><td style={{color:d.r>=0?"#00cc44":"#cc2200"}}>{f2(d.r)}R</td><td style={{color:d.pnl>=0?"#00cc44":"#cc2200"}}>{d.pnl?fPnl(d.pnl):"--"}</td></tr>))}</tbody></table></div></div>)}
      {tab==="system"&&(<div><div className="panel" style={{marginBottom:1}}><div className="ph">JOE ROSS vs ELDER</div><BT rows={bySystem}/></div><div className="g2" style={{marginBottom:1}}><div className="panel"><div className="ph">BY Rh TYPE (JOE ROSS)</div><BT rows={mkBD(RH_TYPES,t=>t.rhType).filter(r=>r.label!=="None")}/></div><div className="panel"><div className="ph">BY IMPULSE COLOUR (ELDER)</div><BT rows={mkBD(IMPULSE,t=>t.impulseSystem)}/></div></div><div className="panel"><div className="ph">BY PIVOT WIDTH (JOE ROSS)</div><BT rows={mkBD(PIVOT_W,t=>t.pivotWidth)} colorFn={l=>l==="Tight"?"#00cc44":l==="Wide"?"#cc2200":null}/></div></div>)}
      {tab==="heatmap"&&(<div><div className="panel" style={{marginBottom:1}}><div className="ph">DAY OF WEEK</div><div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:4}}>{DAYS.map((d,i)=>(<HeatCell key={d} label={d} arr={dayArr(i)}/>))}</div></div><div className="panel" style={{marginBottom:1}}><div className="ph">CALENDAR MONTH</div><div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:4}}>{MNTHS.map((m,i)=>(<HeatCell key={m} label={m} arr={mthArr(i)}/>))}</div></div><div className="panel" style={{marginBottom:1}}><div className="ph">BY YEAR</div>{!years.length?<div style={{color:"#333",fontSize:10}}>NO DATA</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:4}}>{years.map(y=>(<HeatCell key={y} label={y} arr={trades.filter(t=>t.date?.startsWith(y))}/>))}</div>}</div><div className="panel"><div className="ph">WEEKLY (LAST 12 WEEKS)</div>{!getWeeks().length?<div style={{color:"#333",fontSize:10}}>NO DATA</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(80px,1fr))",gap:4}}>{getWeeks().map(([wk,arr])=>(<HeatCell key={wk} label={wk.slice(5)} arr={arr}/>))}</div>}</div></div>)}
      {tab==="rules"&&(<div><div className="g3" style={{marginBottom:1}}>{rulesData.map(g=>(<div key={g.label} className="panel"><div className="ph">{g.label}</div>{g.n===0?<div style={{color:"#333",fontSize:10}}>NO DATA</div>:<div><div style={{fontSize:28,fontWeight:"bold",color:g.color,marginBottom:4}}>{g.wr}%</div><div style={{fontSize:9,color:"#444"}}>WIN RATE</div><div style={{height:1,background:"#111",margin:"8px 0"}}/><div style={{fontSize:13,color:+g.r>=0?"#00cc44":"#cc2200"}}>{f2(g.r)}R</div><div style={{fontSize:9,color:"#444",marginTop:4}}>{g.n} TRADES</div></div>}</div>))}</div><div className="panel"><div className="ph">FULL BREAKDOWN</div><BT rows={rulesData.filter(r=>r.n>0)} colorFn={l=>l==="FOLLOWED"?"#00cc44":l==="BROKEN"?"#cc2200":"#ffaa33"}/></div></div>)}
      {tab==="exits"&&(<div className="panel"><div className="ph">BY EXIT REASON</div><div style={{fontSize:9,color:"#444",marginBottom:8}}>Which exit methods are producing your best realized R</div>{(()=>{const rows=mkBD(EXIT_REASONS,t=>t.exitReason);const unlogged=trades.filter(t=>!t.exitReason||!EXIT_REASONS.includes(t.exitReason));if(unlogged.length)rows.push({label:"(Not Logged)",n:unlogged.length,wr:unlogged.length?(unlogged.filter(t=>t.outcome==="win").length/unlogged.length*100).toFixed(0):null,r:totR(unlogged).toFixed(2)});return!rows.length?<div style={{color:"#333",fontSize:10,textAlign:"center",padding:14}}>NO EXIT REASONS LOGGED YET</div>:<BT rows={rows} colorFn={l=>l==="(Not Logged)"?"#444":null}/>;})()}</div>)}
      {tab==="rolling"&&<RollingExpectancy trades={trades}/>}
    </div>
  );
}

/* GOALS */
function Goals({trades,goals,saveGoals,settings,saveSettings,showToast,mTrades}){
  const [fg,setFg]=useState({...goals});const[fs,setFs]=useState({...settings});
  return(
    <div className="g2" style={{alignItems:"start"}}>
      <div className="panel">
        <div className="ph">TARGETS</div>
        {[["monthlyR","MONTHLY R TARGET","R"],["weeklyR","WEEKLY R TARGET","R"],["winRate","WIN RATE TARGET","%"],["monthlyTrades","MONTHLY TRADES",""]].map(([k,l,u])=>(<div key={k} style={{marginBottom:10}}><label className="fl">{l}</label><input type="number" step="any" value={fg[k]} onChange={e=>setFg(p=>({...p,[k]:+e.target.value||0}))}/></div>))}
        <button className="btn bp" style={{marginBottom:14}} onClick={async()=>{await saveGoals(fg);showToast("SAVED");}}>SAVE TARGETS</button>
        <div className="ph">LOSS LIMITS</div>
        {[["dailyLimit","DAILY LOSS LIMIT (R)"],["monthlyLimit","MONTHLY LOSS LIMIT (R)"]].map(([k,l])=>(<div key={k} style={{marginBottom:10}}><label className="fl">{l}</label><input type="number" step="0.5" value={fs[k]} onChange={e=>setFs(p=>({...p,[k]:+e.target.value||3}))}/></div>))}
        <button className="btn bp" onClick={async()=>{await saveSettings(fs);showToast("SAVED");}}>SAVE LIMITS</button>
      </div>
      <div className="panel">
        <div className="ph">THIS MONTH — {monthNow()}</div>
        <GoalBar label="R EARNED" cur={totR(mTrades)} tgt={goals.monthlyR} unit="R"/>
        <GoalBar label="WIN RATE" cur={+(wRate(mTrades)*100).toFixed(1)} tgt={goals.winRate} unit="%"/>
        <GoalBar label="TRADES" cur={mTrades.length} tgt={goals.monthlyTrades} unit=""/>
      </div>
    </div>
  );
}

/* AI REVIEW — calls your own /api/ai-review serverless function instead of
   Anthropic directly, so the API key stays server-side. See api/ai-review.js. */
function AIReview({trades}){
  const [mode,setMode]=useState("general");const[output,setOutput]=useState("");const[busy,setBusy]=useState(false);
  const MODES=[["general","GENERAL"],["tte","JOE ROSS ANALYSIS"],["elder","ELDER ANALYSIS"],["psychology","PSYCHOLOGY"],["risk","RISK"]];
  const analyze=async()=>{
    if(trades.length<3){setOutput("Need at least 3 trades.");return;}
    setBusy(true);setOutput("");
    const n=trades.length,wr=(wRate(trades)*100).toFixed(1),tr=totR(trades).toFixed(2),ex=expectancy(trades);
    const ross=trades.filter(t=>t.tradingSystem!=="Elder"),elder=trades.filter(t=>t.tradingSystem==="Elder");
    const tte=trades.filter(t=>t.entryType?.includes("TTE"));
    const base=`You are a professional trading coach reviewing a journal that blends two systems: (1) Joe Ross — Ross Hook (Rh) as primary trigger, Ledge/1-2-3/Congestion structures, TTE (enter before pivot breaks) vs Standard Breakout vs Pullback Re-entry; and (2) Elder's Triple Screen — weekly tide, daily wave, impulse system (green/blue/red bars gate entries), value zone (between fast/slow EMA) as the preferred entry area, and RSI/MACD divergence as an early-exit warning. Be specific and data-driven, max 350 words.\n\nSTATS: ${n} trades | WR: ${wr}% | R: ${tr}R | Expectancy: ${ex}R\nJoe Ross trades: ${ross.length} (${ross.length?(wRate(ross)*100).toFixed(0):"--"}%WR) | Elder trades: ${elder.length} (${elder.length?(wRate(elder)*100).toFixed(0):"--"}%WR) | TTE: ${tte.length}`;
    const prompts={general:base+"\n\nComprehensive review. Top 3 improvements.",tte:base+"\n\nFocus on the Joe Ross trades — Rh quality, pivot width, TTE vs Standard, re-entries.",elder:base+"\n\nFocus on the Elder trades — triple screen alignment, impulse system discipline, value-zone entries, divergence exits.",psychology:base+"\n\nEmotional patterns and impact.",risk:base+"\n\nRisk management and drawdown."};
    try{
      const res=await fetch("/api/ai-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt:prompts[mode]})});
      const data=await res.json();
      setOutput(data.error?"Error: "+(data.error.message||data.error):data.content.filter(b=>b.type==="text").map(b=>b.text).join("\n"));
    }catch(e){setOutput("Request failed: "+e.message);}
    setBusy(false);
  };
  return(
    <div className="panel">
      <div className="ph">AI TRADE COACH</div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>{MODES.map(([id,l])=>(<button key={id} className={"esel"+(mode===id?" on":"")} onClick={()=>setMode(id)}>{l}</button>))}</div>
      <button className="btn bp" onClick={analyze} disabled={busy} style={{marginBottom:10}}>{busy?"ANALYZING...":"ANALYZE"}</button>
      {busy&&<div style={{color:"#444",fontSize:10,textAlign:"center",padding:20,letterSpacing:3}}>PROCESSING {trades.length} TRADES...</div>}
      {output&&<div className="ai-out">{output}</div>}
    </div>
  );
}

/* POSITION SIZER — JPY-aware pip multiplier */
function PositionSizer(){
  const [bal,setBal]=useState(10000);const[rp,setRp]=useState(1);const[en,setEn]=useState("");const[sl,setSl]=useState("");const[tp,setTp]=useState("");const[pv,setPv]=useState(10);
  const [pair,setPair]=useState("");
  const isJPY=pair.toUpperCase().includes("JPY");
  const pipMult=isJPY?100:10000;
  const ra=(+bal||0)*(+rp||0)/100,e=+en||0,s=+sl||0,t=+tp||0;
  const slPips=e&&s?Math.abs((e-s)*pipMult).toFixed(1):"--";const rr=e&&s&&t?(Math.abs(t-e)/Math.abs(e-s)).toFixed(2):"--";
  const lots=e&&s&&ra&&pv?(ra/(+slPips*+pv||1)).toFixed(2):"--";const good=rr!=="--"&&+rr>=2,bad=rr!=="--"&&+rr<2;
  return(
    <div>
      <div className="panel" style={{marginBottom:1}}><div className="ph">ACCOUNT</div><div className="frow"><div><label className="fl">BALANCE ($)</label><input type="number" value={bal} onChange={e=>setBal(e.target.value)}/></div><div><label className="fl">RISK %</label><input type="number" step="0.1" value={rp} onChange={e=>setRp(e.target.value)}/></div></div><div style={{padding:"8px 10px",background:"#0a0500",border:"1px solid #332200"}}><div style={{fontSize:9,color:"#554400",marginBottom:2}}>RISK AMOUNT</div><div style={{fontSize:22,color:"#ff8c00",fontWeight:"bold"}}>${ra.toFixed(2)}</div></div></div>
      <div className="panel" style={{marginBottom:1}}><div className="ph">SETUP — STOP AT PIVOT</div><div className="frow"><div><label className="fl">PAIR</label><input value={pair} onChange={e=>setPair(e.target.value)} placeholder="EURUSD / USDJPY"/></div><div><label className="fl">ENTRY</label><input type="number" step="any" value={en} onChange={e=>setEn(e.target.value)}/></div><div><label className="fl">STOP</label><input type="number" step="any" value={sl} onChange={e=>setSl(e.target.value)}/></div><div><label className="fl">TAKE PROFIT</label><input type="number" step="any" value={tp} onChange={e=>setTp(e.target.value)}/></div><div><label className="fl">PIP VALUE ($)</label><input type="number" step="any" value={pv} onChange={e=>setPv(e.target.value)}/></div></div>{isJPY&&<div style={{fontSize:9,color:"#00aaff",marginTop:6}}>JPY pair detected — using ×100 pip multiplier</div>}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:1,background:"#111",marginBottom:8}}>{[["SL PIPS",slPips,"#ff8c00"],["R:R",rr!=="--"?rr+"x":"--",good?"#00cc44":bad?"#cc2200":"#ff8c00"],["STD LOTS",lots,"#00cc44"],["MINI",lots!=="--"?(lots*10).toFixed(1):"--","#00aaff"],["MICRO",lots!=="--"?Math.round(lots*100):"--","#888"]].map(([l,v,c])=>(<div key={l} style={{background:"#0a0a0a",padding:"8px 10px"}}><div style={{fontSize:8,color:"#444",marginBottom:2}}>{l}</div><div style={{fontSize:16,fontWeight:"bold",color:c}}>{v}</div></div>))}</div>
      {bad&&<div style={{padding:"7px 10px",background:"#1a0000",border:"1px solid #440000",fontSize:10,color:"#cc2200"}}>R:R BELOW 1:2 — SKIP.</div>}
      {good&&<div style={{padding:"7px 10px",background:"#001a00",border:"1px solid #004400",fontSize:10,color:"#00cc44"}}>R:R CLEARS 1:2 — SETUP QUALIFIES.</div>}
    </div>
  );
}

/* HTF BIAS LOGGER + LIFE INDEX */
function HTFLogger({htfLog,saveHtfLog,lifeLog,saveLifeLog,showToast,trades}){
  const [tab,setTab]=useState("bias");
  const BLANK_HTF={date:today(),weekly:"Neutral",daily:"Neutral",h4:"Neutral",h1:"Neutral",keyLevels:"",rhZones:"",news:"",notes:""};
  const [bForm,setBForm]=useState(BLANK_HTF);
  const BF=(k,v)=>setBForm(p=>({...p,[k]:v}));
  const [liSel,setLiSel]=useState({});
  const [liDate,setLiDate]=useState(today());
  const todayHtf=htfLog.some(e=>e.date===bForm.date);
  const bVals=[bForm.weekly,bForm.daily,bForm.h4,bForm.h1];
  const bBulls=bVals.filter(v=>v?.includes("Bull")).length,bBears=bVals.filter(v=>v?.includes("Bear")).length;
  const bAligned=bBulls>=3||bBears>=3,bDir=bBulls>=3?"BULLISH":bBears>=3?"BEARISH":"MIXED";
  const bAlignColor=bAligned?(bBulls>=3?"#00cc44":"#cc2200"):"#ffaa33";
  const bCorr=htfLog.slice(0,30).map(b=>{const dt=trades.filter(t=>t.date===b.date);if(!dt.length)return null;return{date:b.date,d1:b.daily,h4:b.h4,n:dt.length,wr:(wRate(dt)*100).toFixed(0),r:totR(dt).toFixed(2)};}).filter(Boolean);
  const totalLI=liScore(liSel);
  const todayLI=lifeLog.find(e=>e.date===liDate);
  const handleSaveBias=async()=>{await saveHtfLog([{...bForm,id:Date.now()},...htfLog.filter(e=>e.date!==bForm.date)].slice(0,90));showToast("BIAS SAVED");};
  const handleSaveLI=async()=>{
    const allMetrics=LI_DOMAINS.flatMap(d=>d.metrics.map(m=>m.id));
    if(allMetrics.some(id=>liSel[id]===undefined)){showToast("COMPLETE ALL METRICS");return;}
    const entry={date:liDate,id:Date.now(),selections:{...liSel},total:totalLI,domains:Object.fromEntries(LI_DOMAINS.map(d=>[d.id,liDomScore(d,liSel)]))};
    await saveLifeLog([entry,...lifeLog.filter(e=>e.date!==liDate)].slice(0,90));showToast("LIFE INDEX SAVED");
  };
  const loadLIEntry=entry=>{if(entry)setLiSel({...entry.selections});};
  return(
    <div>
      <div className="tabrow">
        <button className={"tb"+(tab==="bias"?" on":"")} onClick={()=>setTab("bias")}>MORNING BIAS</button>
        <button className={"tb"+(tab==="life"?" on":"")} onClick={()=>setTab("life")}>LIFE INDEX</button>
      </div>
      {tab==="bias"&&(
        <div className="g2" style={{alignItems:"start"}}>
          <div className="panel">
            <div className="ph">MORNING BIAS — {today()}</div>
            {todayHtf&&<div style={{padding:"4px 8px",background:"#001a00",border:"1px solid #004400",fontSize:9,color:"#00cc44",marginBottom:8}}>TODAY LOGGED — saving will overwrite</div>}
            <div style={{marginBottom:8}}><label className="fl">DATE</label><input type="date" value={bForm.date} onChange={e=>BF("date",e.target.value)}/></div>
            {[["weekly","WEEKLY (W1)"],["daily","DAILY (D1)"],["h4","4-HOUR (H4)"],["h1","1-HOUR (H1)"]].map(([k,l])=>(<div key={k} style={{marginBottom:10}}><label className="fl">{l}</label><div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{BIAS_OPTS.map(b=>(<button key={b} className={"esel"+(bForm[k]===b?" on":"")} style={{color:bForm[k]===b?biasColor(b):"#555",borderColor:bForm[k]===b?biasColor(b):"#222"}} onClick={()=>BF(k,b)}>{b.toUpperCase()}</button>))}</div></div>))}
            <div style={{padding:"6px 10px",background:"#080808",border:"1px solid #1a1a1a",marginBottom:10}}><div style={{fontSize:10,color:bAlignColor,fontWeight:"bold"}}>{bAligned?`✓ ${bDir} ALIGNMENT — favour setups in this direction`:`⚠ MIXED SCREENS — only highest-quality setups`}</div></div>
            {[["keyLevels","KEY S/R LEVELS"],["rhZones","POTENTIAL ENTRY ZONES TODAY"],["news","HIGH-IMPACT NEWS"],["notes","SESSION NOTES"]].map(([k,l])=>(<div key={k} style={{marginBottom:8}}><label className="fl">{l}</label><textarea value={bForm[k]||""} onChange={e=>BF(k,e.target.value)}/></div>))}
            <button className="btn bp" onClick={handleSaveBias}>SAVE BIAS</button>
          </div>
          <div>
            <div className="panel" style={{marginBottom:1}}><div className="ph">BIAS HISTORY</div>{!htfLog.length?<div style={{color:"#333",fontSize:10}}>NO ENTRIES</div>:htfLog.slice(0,12).map((b,i)=>(<div key={i} style={{padding:"8px 0",borderBottom:"1px solid #0f0f0f"}}><div style={{color:"#ff8c00",fontSize:10,marginBottom:4}}>{b.date}</div><div style={{display:"flex",gap:12,flexWrap:"wrap"}}>{[["W1",b.weekly],["D1",b.daily],["H4",b.h4],["H1",b.h1]].map(([tf,bias])=>(<span key={tf} style={{fontSize:9}}><span style={{color:"#333"}}>{tf} </span><span style={{color:biasColor(bias),fontWeight:"bold"}}>{(bias||"--").toUpperCase()}</span></span>))}</div>{b.rhZones&&<div style={{fontSize:9,color:"#ff8c00",marginTop:3}}>Zones: {b.rhZones.slice(0,60)}</div>}{b.news&&<div style={{fontSize:9,color:"#ffaa33",marginTop:2}}>News: {b.news.slice(0,50)}</div>}</div>))}</div>
            {bCorr.length>0&&(<div className="panel"><div className="ph">BIAS vs OUTCOME</div><table><thead><tr>{["DATE","D1","H4","N","WR","R"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{bCorr.map((r,i)=>(<tr key={i}><td style={{color:"#555"}}>{r.date}</td><td style={{color:biasColor(r.d1),fontSize:9}}>{(r.d1||"").toUpperCase()}</td><td style={{color:biasColor(r.h4),fontSize:9}}>{(r.h4||"").toUpperCase()}</td><td>{r.n}</td><td style={{color:+r.wr>=50?"#00cc44":"#cc2200"}}>{r.wr}%</td><td style={{color:+r.r>=0?"#00cc44":"#cc2200"}}>{f2(r.r)}R</td></tr>))}</tbody></table></div>)}
          </div>
        </div>
      )}
      {tab==="life"&&(
        <div>
          <div className="panel" style={{marginBottom:1}}>
            <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
              <div><label className="fl">DATE</label><input type="date" value={liDate} onChange={e=>{setLiDate(e.target.value);const prev=lifeLog.find(x=>x.date===e.target.value);if(prev)loadLIEntry(prev);else setLiSel({});}} style={{width:140}}/></div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:11,color:"#555",marginBottom:2}}>TOTAL SCORE</div>
                <div style={{fontSize:32,fontWeight:"bold",color:liColor(totalLI)}}>{totalLI}<span style={{fontSize:14,color:"#333"}}>/{liMax}</span></div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11,fontWeight:"bold",color:liColor(totalLI),letterSpacing:1,marginBottom:4}}>{liGate(totalLI)}</div>
                <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                  <button className="btn bp" onClick={handleSaveLI}>SAVE</button>
                  {todayLI&&<button className="btn" onClick={()=>loadLIEntry(todayLI)}>LOAD TODAY</button>}
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:10}}>
              {LI_DOMAINS.map(d=>{const ds=liDomScore(d,liSel);const pct=ds/d.max*100;return(<div key={d.id}><div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:"#444",marginBottom:2}}><span style={{color:d.color}}>{d.label}</span><span>{ds}/{d.max}</span></div><div style={{height:3,background:"#111"}}><div style={{width:pct+"%",height:3,background:d.color,transition:"width .2s"}}/></div></div>);})}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,background:"#111",marginBottom:1}}>
            {LI_DOMAINS.map(d=>(
              <div key={d.id} className="panel">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:9,letterSpacing:2,color:d.color,fontWeight:"bold"}}>{d.label}</span>
                  <span style={{fontSize:16,fontWeight:"bold",color:liColor(liDomScore(d,liSel)/d.max*40)}}>{liDomScore(d,liSel)}<span style={{fontSize:10,color:"#333"}}>/{d.max}</span></span>
                </div>
                {d.metrics.map(m=>(
                  <div key={m.id} style={{marginBottom:10}}>
                    <div style={{fontSize:8,color:"#555",marginBottom:4,letterSpacing:1}}>{m.label.toUpperCase()}</div>
                    <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                      {m.opts.map(([label,pts])=>(
                        <button key={label} onClick={()=>setLiSel(p=>({...p,[m.id]:pts}))}
                          style={{padding:"2px 6px",border:"1px solid "+(liSel[m.id]===pts?d.color:"#222"),background:liSel[m.id]===pts?"#0a0a0a":"transparent",color:liSel[m.id]===pts?d.color:"#555",fontSize:9,cursor:"pointer",fontFamily:"monospace",transition:"all .1s"}}>
                          {label} <span style={{color:"#333",fontSize:8}}>({pts})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {lifeLog.length>0&&(
            <div className="panel">
              <div className="ph">HISTORY</div>
              <table><thead><tr>{["DATE","TOTAL","SLEEP","PHYSICAL","MIND","FINANCIAL","GATE"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{lifeLog.slice(0,14).map((e,i)=>(
                  <tr key={i} style={{cursor:"pointer"}} onClick={()=>{setLiDate(e.date);loadLIEntry(e);}}>
                    <td style={{color:"#ff8c00"}}>{e.date}</td>
                    <td style={{color:liColor(e.total),fontWeight:"bold"}}>{e.total}/{liMax}</td>
                    {LI_DOMAINS.map(d=>(<td key={d.id} style={{color:d.color}}>{e.domains?.[d.id]??"-"}/{d.max}</td>))}
                    <td style={{color:liColor(e.total),fontSize:9}}>{e.total>=32?"OPTIMAL":e.total>=24?"GOOD":e.total>=16?"MARGINAL":"POOR"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── AUTH GATE ──
   Wraps the journal with Supabase email/password auth. The journal itself
   (JournalApp) renders only once a session exists, since the kv table's RLS
   policies need auth.uid() to know whose rows to return. */
function AuthGate(){
  const [session,setSession]=useState(undefined); // undefined = loading, null = signed out
  const [mode,setMode]=useState("signin"); // signin | signup
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:sub}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));
    return()=>sub.subscription.unsubscribe();
  },[]);

  const submit=async e=>{
    e.preventDefault();
    setErr("");setNotice("");setBusy(true);
    const fn=mode==="signin"?supabase.auth.signInWithPassword:supabase.auth.signUp;
    const {error}=await fn({email,password});
    setBusy(false);
    if(error){setErr(error.message);return;}
    if(mode==="signup")setNotice("Check your email to confirm your account, then sign in.");
  };

  if(session===undefined){
    return(<div style={{background:"#000",height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",color:"#444"}}>LOADING…</div>);
  }

  if(!session){
    return(
      <div style={{background:"#000",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Courier New',monospace",color:"#ff8c00"}}>
        <form onSubmit={submit} style={{width:300,background:"#0a0a0a",border:"1px solid #222",padding:20}}>
          <div style={{fontSize:9,letterSpacing:4,color:"#444",marginBottom:4}}>JOE ROSS + ELDER</div>
          <div style={{fontSize:16,letterSpacing:3,marginBottom:16}}>TRADING JOURNAL</div>
          <div style={{display:"flex",gap:4,marginBottom:14}}>
            {["signin","signup"].map(m=>(
              <button key={m} type="button" onClick={()=>{setMode(m);setErr("");setNotice("");}}
                style={{flex:1,padding:"5px 0",border:"1px solid "+(mode===m?"#ff8c00":"#222"),background:mode===m?"#1a0800":"transparent",color:mode===m?"#ff8c00":"#555",fontSize:10,letterSpacing:1,cursor:"pointer",fontFamily:"inherit"}}>
                {m==="signin"?"SIGN IN":"SIGN UP"}
              </button>
            ))}
          </div>
          <div style={{marginBottom:10}}>
            <label style={{fontSize:9,letterSpacing:1,color:"#555",display:"block",marginBottom:2}}>EMAIL</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)}
              style={{width:"100%",background:"#0a0a0a",border:"1px solid #333",color:"#ff8c00",padding:"6px 8px",fontFamily:"inherit",fontSize:12}}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:9,letterSpacing:1,color:"#555",display:"block",marginBottom:2}}>PASSWORD</label>
            <input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)}
              style={{width:"100%",background:"#0a0a0a",border:"1px solid #333",color:"#ff8c00",padding:"6px 8px",fontFamily:"inherit",fontSize:12}}/>
          </div>
          {err&&<div style={{fontSize:10,color:"#cc2200",marginBottom:10}}>{err}</div>}
          {notice&&<div style={{fontSize:10,color:"#00cc44",marginBottom:10}}>{notice}</div>}
          <button type="submit" disabled={busy}
            style={{width:"100%",padding:"8px 0",border:"1px solid #ff8c00",background:"#ff8c00",color:"#000",fontWeight:"bold",fontSize:11,letterSpacing:1,cursor:"pointer",fontFamily:"inherit"}}>
            {busy?"…":mode==="signin"?"SIGN IN":"CREATE ACCOUNT"}
          </button>
        </form>
      </div>
    );
  }

  return(
    <div>
      <div style={{position:"fixed",top:0,right:0,zIndex:200,padding:"4px 10px",fontSize:9,color:"#444",fontFamily:"'Courier New',monospace"}}>
        <span style={{marginRight:10}}>{session.user.email}</span>
        <button onClick={()=>supabase.auth.signOut()} style={{background:"transparent",border:"1px solid #333",color:"#888",fontSize:9,padding:"2px 6px",cursor:"pointer",fontFamily:"inherit"}}>SIGN OUT</button>
      </div>
      <JournalApp/>
    </div>
  );
}

export default function App(){
  return <AuthGate/>;
}
