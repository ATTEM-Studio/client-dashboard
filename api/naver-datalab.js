function auth(req){
  const expected=process.env.TEAM_PASSWORD;
  const given=req.headers['x-team-token']||(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  return Boolean(expected&&given===expected);
}
function isoDate(value,fallback){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return fallback;
  const d=new Date(value+'T00:00:00Z');
  return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value?fallback:value;
}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'POST only'});
  if(!auth(req)) return res.status(401).json({error:'인증이 필요합니다.'});
  const clientId=process.env.NAVER_DATALAB_CLIENT_ID, clientSecret=process.env.NAVER_DATALAB_CLIENT_SECRET;
  if(!clientId||!clientSecret) return res.status(503).json({error:'네이버 데이터랩 API 환경변수가 설정되지 않았습니다.'});
  let body=req.body; if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}
  const keyword=String(body&&body.keyword||'').trim();
  if(!keyword||/\s/.test(keyword)) return res.status(400).json({error:'띄어쓰기 없이 한 단어를 입력해 주세요.'});
  const end=new Date().toISOString().slice(0,10);
  const start=isoDate(body&&body.startDate,new Date(Date.now()-365*86400000).toISOString().slice(0,10));
  const timeUnit=['date','week','month'].includes(body&&body.timeUnit)?body.timeUnit:'date';
  try{
    const upstream=await fetch('https://openapi.naver.com/v1/datalab/search',{method:'POST',headers:{'Content-Type':'application/json','X-Naver-Client-Id':clientId,'X-Naver-Client-Secret':clientSecret},body:JSON.stringify({startDate:start,endDate:isoDate(body&&body.endDate,end),timeUnit,keywordGroups:[{groupName:keyword,keywords:[keyword]}]})});
    const data=await upstream.json().catch(()=>({}));
    return res.status(upstream.status).json(data);
  }catch(e){return res.status(502).json({error:'네이버 데이터랩 API에 연결하지 못했습니다.'});}
};
