const fs=require('fs');
const path=require('path');
const api=fs.readFileSync(path.join(__dirname,'..','api','naver-datalab.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
function assert(ok,msg){if(!ok) throw new Error(msg);}
assert(api.includes("naverapihub.apigw.ntruss.com/search-trend/v1/search"),'DataLab API HUB endpoint missing');
assert(api.includes("naveropenapi.apigw.ntruss.com/datalab/v1/search"),'DataLab API HUB compatibility endpoint missing');
assert(api.includes('NAVER_DATALAB_CLIENT_ID')&&api.includes('NAVER_DATALAB_CLIENT_SECRET'),'DataLab env vars missing');
assert(api.includes("'X-NCP-APIGW-API-KEY-ID'")&&api.includes("'X-NCP-APIGW-API-KEY'"),'DataLab API HUB headers missing');
assert(api.includes('keywordGroups')&&api.includes('timeUnit'),'DataLab request payload missing');
assert(api.includes("req.method!=='POST'")&&api.includes('401'),'DataLab auth guard missing');
assert(html.includes('/api/naver-datalab'),'Keyword screen does not call DataLab');
assert(html.includes('datalab-trend-card')&&html.includes('검색 관심도 추이'),'DataLab trend UI missing');
assert(html.includes('runSingleDataLabSearch'),'Single keyword mode must have a dedicated DataLab-first search flow');
assert(html.includes("addEventListener('click',runSingleDataLabSearch,true)"),'Single keyword search must intercept the Search Ads result flow');
assert(html.includes('id="datalab-time-unit"')&&html.includes('id="datalab-start-date"')&&html.includes('id="datalab-end-date"'),'DataLab period controls missing');
assert(html.includes('datalab-summary-card'),'DataLab single result summary missing');
console.log('naver-datalab.test.js: ok');
