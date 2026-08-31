const crypto = require('crypto');
const { isAuthenticated } = require('./_session');
function sign(method,path,timestamp,license,secret){
  return crypto.createHmac('sha256',secret).update(`${timestamp}.${method}.${path}`).digest('base64');
}
module.exports=async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'POST only'}); }
  if(!isAuthenticated(req)) return res.status(401).json({error:'인증이 필요합니다'});
  const license=process.env.NAVER_AD_API_LICENSE, secret=process.env.NAVER_AD_API_SECRET, customer=process.env.NAVER_AD_CUSTOMER_ID;
  if(!license||!secret||!customer) return res.status(503).json({error:'서비스를 일시적으로 사용할 수 없습니다'});
  let body=req.body; if(typeof body==='string'){try{body=JSON.parse(body);}catch{body={};}}
  const keywords=Array.isArray(body&&body.keywords)?body.keywords.map(v=>String(v).trim()).filter(Boolean).slice(0,10):[];
  if(!keywords.length) return res.status(400).json({error:'키워드를 입력해 주세요'});
  const path='/keywordstool'; const timestamp=String(Date.now());
    const url=new URL('https://api.searchad.naver.com'+path);
  url.searchParams.set('hintKeywords',keywords.join(',')); url.searchParams.set('showDetail','1');
  try{
    const upstream=await fetch(url,{headers:{'X-Timestamp':timestamp,'X-API-KEY':license,'X-Customer':String(customer),'X-Signature':sign('GET',path,timestamp,license,secret)}});
    const data=await upstream.json().catch(()=>({}));
    if(upstream.status===401||upstream.status===403) return res.status(502).json({error:'외부 서비스 요청에 실패했습니다'});
    return res.status(upstream.status).json(data);
  }catch(e){ return res.status(502).json({error:'네이버 키워드 API에 연결하지 못했습니다'}); }
};
