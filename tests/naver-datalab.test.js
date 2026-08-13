const fs=require('fs');
const path=require('path');
const api=fs.readFileSync(path.join(__dirname,'..','api','naver-datalab.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(ok,msg){if(!ok) throw new Error(msg);}
assert(api.includes("openapi.naver.com/v1/datalab/search"),'DataLab endpoint missing');
assert(api.includes('NAVER_DATALAB_CLIENT_ID')&&api.includes('NAVER_DATALAB_CLIENT_SECRET'),'DataLab env vars missing');
assert(api.includes("'X-Naver-Client-Id'")&&api.includes("'X-Naver-Client-Secret'"),'DataLab headers missing');
assert(api.includes('keywordGroups')&&api.includes('timeUnit'),'DataLab request payload missing');
assert(api.includes("req.method!=='POST'")&&api.includes('401'),'DataLab auth guard missing');
assert(html.includes('/api/naver-datalab'),'Keyword screen does not call DataLab');
assert(html.includes('datalab-trend-card')&&html.includes('검색 관심도 추이'),'DataLab trend UI missing');
console.log('naver-datalab.test.js: ok');
