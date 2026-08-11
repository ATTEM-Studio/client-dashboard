# Contract Management Design

## Goal

홈에서 계약서를 생성하고, 업체 상세에서 저장된 계약서를 확인하며, 업체 정보 수정 화면에서 재계약 회차를 직접 보정할 수 있게 한다.

## Scope

- 홈 우측 액션에 `업체 등록`, `계약서 생성` 버튼을 함께 둔다.
- 계약서 생성 화면은 업체 선택, 계약 유형, 시작일, 기간, 월 금액, 주요 조건, 서명 영역을 제공한다.
- 계약서는 `contracts-index`와 `contract:<id>`에 저장한다.
- 업체 상세에는 `계약서` 탭을 추가해 해당 업체의 계약서 목록을 보여준다.
- 업체 정보 수정 화면에서 계약 유형이 `재계약`일 때 재계약 회차를 숫자로 수정할 수 있게 한다.
- 회차 수정은 체크리스트, 리포트, 매출, 안내문 데이터를 삭제하지 않는다.

## Non-goals

- PDF 다운로드/인쇄 최적화는 다음 단계로 둔다.
- 외부 전자계약 API 연동은 하지 않는다.

## Data Shape

```js
{
  id: "ct_xxx",
  clientId: "cl_xxx",
  clientName: "업체명",
  contractType: "new" | "renewal",
  renewalCount: 1,
  startDate: "2026-08-17",
  contractMonths: "3",
  fee: "800000",
  terms: "주요 조건",
  signerName: "서명자",
  signatureDataUrl: "data:image/png;base64,...",
  createdAt: 123,
  updatedAt: 123
}
```

## Testing

- 홈 버튼 마크업과 계약서 화면 진입 버튼을 검증한다.
- 계약서 생성 화면 필드와 서명 영역을 검증한다.
- 저장 함수가 `contract:<id>`와 `contracts-index`를 갱신하는지 검증한다.
- 업체 상세 계약서 탭이 해당 업체 계약서만 보여주는지 검증한다.
- 업체 수정 폼에서 재계약 회차 입력과 저장 반영을 검증한다.
