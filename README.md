# 업체 관리 대시보드

마케팅 대행사를 위한 업체 관리 · 리포트 생성 도구입니다.
데이터는 Upstash Redis에 저장되어 팀원 모두가 같은 화면을 공유합니다.

## 주요 기능

- **업체 관리** — 신규 업체 등록, 계약 정보(신규/재계약, 시작일, 기간, 상태) 관리
- **월별 대시보드** — 관리 업체 수, 신규 계약, 재계약, 전체 진행률 집계
- **주차별 진행 관리** — 업체마다 주차 칸을 눌러 미시작 → 진행 → 완료로 전환
- **업무 체크리스트** — 업체별로 주차를 지정해 업무 등록 및 완료 처리
- **리포트 작성** — 주간 리포트와 월간 리포트를 업체별로 작성
- **팀 공유** — 팀 비밀번호로 접속하면 모두가 같은 데이터를 조회
- **링크 공유** — 리포트 링크를 전달하면 클라이언트가 비밀번호 없이 열람

## 구성

```
index.html      대시보드 전체 (빌드 불필요)
api/auth.js     팀 비밀번호 확인
api/data.js     Upstash Redis 읽기/쓰기
vercel.json     배포 설정
```

## 배포 순서

### 1. GitHub 비공개 저장소에 올리기

```bash
git init
git add .
git commit -m "업체 관리 대시보드 초기 커밋"
git branch -M main
git remote add origin https://github.com/사용자명/저장소명.git
git push -u origin main
```

### 2. Vercel에 프로젝트 연결

Vercel에서 **Add New → Project**로 저장소를 Import합니다.
Framework Preset은 **Other**, Build Command와 Output Directory는 **비워 둡니다.**

### 3. Redis 연결

Vercel KV는 더 이상 제공되지 않습니다. 대신 Marketplace의 Upstash Redis를 사용합니다.

프로젝트의 **Storage** 탭에서 **Upstash Redis**를 선택해 연결하면
`KV_REST_API_URL`과 `KV_REST_API_TOKEN`이 자동으로 주입됩니다.
별도로 값을 복사할 필요는 없습니다.

### 4. 환경 변수 설정

프로젝트 **Settings → Environment Variables**에서 아래 이름을 설정합니다. 값은 저장소, 문서, 로그에 기록하지 않습니다.

| 이름 | 용도 |
| --- | --- |
| `TEAM_PASSWORD` | 팀 대시보드 로그인 |
| `KV_REST_API_URL` | Upstash Redis REST 연결 |
| `KV_REST_API_TOKEN` | Upstash Redis REST 인증 |
| `NAVER_AD_API_LICENSE` | 네이버 검색광고 키워드 조회 |
| `NAVER_AD_API_SECRET` | 네이버 검색광고 키워드 조회 |
| `NAVER_AD_CUSTOMER_ID` | 네이버 검색광고 키워드 조회 |
| `NAVER_DATALAB_CLIENT_ID` | 네이버 데이터랩 조회 |
| `NAVER_DATALAB_CLIENT_SECRET` | 네이버 데이터랩 조회 |

Production, Preview, Development 모두에 적용한 뒤 **재배포**합니다.
환경변수는 배포 시점에 주입되므로, 추가 후 반드시 다시 배포해야 반영됩니다.

## 접근 권한

- **팀원** — 비밀번호를 입력하면 모든 업체·리포트를 조회하고 편집할 수 있습니다.
- **외부 공유 링크** — `/?report=리포트ID` 형태이며, 해당 리포트 하나만 읽기 전용으로 열립니다.
  업체 목록이나 다른 리포트에는 접근할 수 없고, 수정·삭제 버튼도 표시되지 않습니다.

비밀번호는 팀 단위 공용입니다. 개인별 계정이나 권한 구분이 필요하면
별도의 인증 서비스를 붙여야 합니다.

## 로컬에서 실행

API가 필요하므로 Vercel CLI로 실행합니다.

```bash
npm i -g vercel
vercel dev
```

로컬 실행도 위 환경 변수 이름을 사용합니다. 실제 값은 버전 관리나 터미널 출력에 남기지 마세요.

## 검증 및 릴리스 게이트

로컬과 GitHub Actions는 동일한 전체 테스트 명령을 사용합니다.

```bash
for file in tests/*.test.js; do node "$file" || exit 1; done
```

GitHub의 `Dashboard Quality` 상태 확인과 Vercel Preview가 모두 통과한 커밋만 운영으로 승격합니다. Preview에서는 로그인·새로고침·로그아웃, 데모의 staff API 호출 0회, 기존 안내문·계약서·리포트 링크, 390px 가로 넘침, 런타임 오류 0건을 확인합니다.

운영 승격 후에는 배포 SHA가 `main`과 같고 상태가 `READY`인지 확인한 뒤, 세션 없는 보호 API가 401을 반환하고 공개 API가 허용 필드만 반환하는지 요청으로 검증합니다. 해당 스모크 요청 뒤에도 런타임 오류가 0건이어야 합니다.

## 데이터 백업

모든 데이터는 Redis에 `rs:` 접두사로 저장됩니다.
Upstash 콘솔에서 직접 조회하거나 내보낼 수 있습니다.
