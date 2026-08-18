(function (root) {
  "use strict";

  var DEMO_STORAGE_KEY = "rs:browser-demo-workspace:v1";
  var DEMO_SCHEMA_VERSION = 1;
  var memoryWorkspace = null;

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function localDay(now) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function addCalendarDays(date, amount) {
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function isoDate(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function timestamp(date, hour) {
    var value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour || 10, 0, 0, 0);
    return value.getTime();
  }

  function checklist(id, text, week, day, done) {
    return { id: id, text: text, week: String(week), day: day, done: !!done, demo: true };
  }

  function clientIndex(client) {
    return {
      id: client.id, name: client.name, contractType: client.contractType,
      renewalCount: client.renewalCount, startDate: client.startDate,
      status: client.status, updatedAt: client.updatedAt, demoStage: client.demoStage,
      demo: true
    };
  }

  function buildDemoClients(today) {
    var upcomingStart = addCalendarDays(today, 7);
    var activeStart = addCalendarDays(today, -7);
    var renewalStart = addCalendarDays(today, -21);
    return [
      {
        id: "demo-client-dawn", name: "새벽식탁 연남", industry: "브런치 카페", manager: "데모 매니저",
        contractType: "new", startDate: isoDate(upcomingStart), contractMonths: "3", fee: "900000",
        status: "upcoming", demoStage: "upcoming", excludeWeekends: true,
        memo: "월요일 오픈 전, 대표 메뉴 촬영 일정 확인", checklist: [
          checklist("demo-task-dawn-1", "대표 메뉴와 영업시간 확인", 1, 1, false),
          checklist("demo-task-dawn-2", "플레이스 소개 문구 초안 공유", 1, 2, false),
          checklist("demo-task-dawn-3", "사진 촬영 컷 구성 확정", 1, 3, false)
        ], progress: {}, renewals: [], dailyNotes: {}, createdAt: timestamp(today, 9), updatedAt: timestamp(today, 9), demo: true
      },
      {
        id: "demo-client-moss", name: "모스도자기 합정", industry: "공방·클래스", manager: "데모 매니저",
        contractType: "new", startDate: isoDate(activeStart), contractMonths: "3", fee: "1200000",
        status: "active", demoStage: "active-week-2", excludeWeekends: true,
        memo: "체험 클래스 예약 전환을 우선으로 운영", checklist: [
          checklist("demo-task-moss-1", "예약 버튼 유입 경로 점검", 1, 1, true),
          checklist("demo-task-moss-2", "체험 후기 3건 답변", 1, 3, true),
          checklist("demo-task-moss-3", "주말 클래스 소재 교체", 2, 6, false),
          checklist("demo-task-moss-4", "검색어 성과 공유", 2, 8, false)
        ], progress: {}, renewals: [], dailyNotes: {}, createdAt: timestamp(addCalendarDays(today, -9), 10), updatedAt: timestamp(today, 11), demo: true
      },
      {
        id: "demo-client-orbit", name: "오빗베이크 성수", industry: "베이커리", manager: "데모 매니저",
        contractType: "renewal", renewalCount: 4, startDate: isoDate(renewalStart), contractMonths: "1", fee: "1500000",
        status: "active", demoStage: "renewal-week-4", excludeWeekends: true,
        memo: "재계약 전 선물세트 전환 성과와 9월 캠페인을 함께 제안", checklist: [
          checklist("demo-task-orbit-1", "추석 선물세트 키워드 점검", 3, 11, true),
          checklist("demo-task-orbit-2", "재계약 성과 요약 초안", 4, 16, false),
          checklist("demo-task-orbit-3", "다음 달 예산안 제안", 4, 18, false),
          checklist("demo-task-orbit-4", "대표 미팅 안건 정리", "closing", 22, false)
        ], progress: {}, renewals: [today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0")], dailyNotes: {}, createdAt: timestamp(addCalendarDays(today, -24), 10), updatedAt: timestamp(today, 14), demo: true
      }
    ];
  }

  function buildDemoReports(today) {
    var month = today.getFullYear() + "년 " + (today.getMonth() + 1) + "월";
    return [
      {
        id: "demo-report-moss-week-2", clientId: "demo-client-moss", clientName: "모스도자기 합정", type: "weekly",
        period: month + " 2주차", goal: "체험 클래스 예약 문의 확대", deliveryMemo: "신규 썸네일과 후기 답변을 반영했습니다.",
        channels: [{ name: "네이버 플레이스", metrics: [{ label: "광고비", value: "320000" }, { label: "CTR", value: "3.8" }, { label: "예약 문의", value: "18" }], demo: true }],
        revenue: { weekly: 1840000 }, createdAt: timestamp(addCalendarDays(today, -2), 10), updatedAt: timestamp(today, 12), demo: true
      },
      {
        id: "demo-report-orbit-week-4", clientId: "demo-client-orbit", clientName: "오빗베이크 성수", type: "weekly",
        period: month + " 4주차", goal: "선물세트 예약 전환 점검", deliveryMemo: "재계약 미팅용 성과 요약을 준비했습니다.",
        channels: [{ name: "검색 광고", metrics: [{ label: "광고비", value: "450000" }, { label: "ROAS", value: "420" }, { label: "전화 문의", value: "26" }], demo: true }],
        revenue: { weekly: 3120000 }, createdAt: timestamp(addCalendarDays(today, -1), 10), updatedAt: timestamp(today, 15), demo: true
      }
    ];
  }

  function buildDemoContracts(clients, today) {
    return [
      {
        id: "demo-contract-moss", clientId: clients[1].id, clientName: clients[1].name, contractType: "new", renewalCount: 1,
        productType: "regular", productName: "로컬 매장 성장 관리", supplyPrice: "1200000", paymentMethod: "transfer",
        startDate: clients[1].startDate, contractMonths: "3", fee: "1200000", owner: "데모 매니저",
        terms: "데모 전용 계약 상태입니다. 실제 계약이나 청구가 발생하지 않습니다.", signerName: "데모 서명", signatureDataUrl: "",
        createdAt: timestamp(addCalendarDays(today, -9), 9), updatedAt: timestamp(today, 11), demoState: "preview", demo: true
      },
      {
        id: "demo-contract-orbit", clientId: clients[2].id, clientName: clients[2].name, contractType: "renewal", renewalCount: 4,
        productType: "regular", productName: "시즌 캠페인 운영", supplyPrice: "1500000", paymentMethod: "card",
        startDate: clients[2].startDate, contractMonths: "1", fee: "1500000", owner: "데모 매니저",
        terms: "데모 전용 재계약 미리보기입니다. 외부 링크를 발급하지 않습니다.", signerName: "데모 서명", signatureDataUrl: "",
        createdAt: timestamp(addCalendarDays(today, -24), 9), updatedAt: timestamp(today, 14), demoState: "renewal-review", demo: true
      }
    ];
  }

  function buildDemoChecklistSets() {
    return [{
      id: "demo-set-weekday", name: "평일 매장 시작 세트", excludeWeekends: true, demo: true,
      items: [
        { id: "demo-set-1", day: 1, text: "브랜드 정보와 영업시간 확인", demo: true },
        { id: "demo-set-2", day: 2, text: "대표 키워드 우선순위 정리", demo: true },
        { id: "demo-set-3", day: 3, text: "사진·소재 요청 목록 공유", demo: true },
        { id: "demo-set-4", day: 4, text: "첫 주 결과 간단 공유", demo: true }
      ]
    }];
  }

  function createDemoSeed(now) {
    var today = localDay(now instanceof Date ? now : new Date());
    var clients = buildDemoClients(today);
    var reports = buildDemoReports(today);
    var contracts = buildDemoContracts(clients, today);
    var values = {
      "clients-index": clients.map(clientIndex),
      "reports-index": reports.map(function (report) { return clone(report); }),
      "contracts-index": contracts.map(function (contract) { return clone(contract); }),
      "contract-base-terms-template": "데모 계약은 학습용 화면이며 실제 효력이 없습니다.",
      "checklist-sets": buildDemoChecklistSets()
    };
    clients.forEach(function (client) { values["client:" + client.id] = clone(client); });
    reports.forEach(function (report) { values["report:" + report.id] = clone(report); });
    contracts.forEach(function (contract) { values["contract:" + contract.id] = clone(contract); });
    values["guide:demo-guide-moss"] = {
      id: "demo-guide-moss", clientId: "demo-client-moss", createdAt: timestamp(today, 9), updatedAt: timestamp(today, 12), submittedAt: null,
      answers: { concern: "체험 클래스 예약이 고르게 들어오지 않아요.", goal: "평일 예약 문의를 늘리고 싶어요.", priorityMenu: "물레 체험", desiredCustomers: "주말 데이트 고객", strengths: "직접 만든 유약과 차분한 수업", contentTone: "따뜻하고 차분하게" },
      demoState: "draft", demo: true
    };
    values["guide-review:demo-guide-moss"] = { guideId: "demo-guide-moss", clientId: "demo-client-moss", status: "in-review", memo: "사진 톤과 예약 안내 문구를 검토 중입니다.", demo: true };
    values["client:demo-client-moss"].guideId = "demo-guide-moss";
    return { version: DEMO_SCHEMA_VERSION, seededAt: today.toISOString(), values: values, persistent: true };
  }

  function isValidWorkspace(value) {
    return !!value && value.version === DEMO_SCHEMA_VERSION && value.values && typeof value.values === "object";
  }

  function writeWorkspace(storage, workspace) {
    try {
      storage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ version: workspace.version, seededAt: workspace.seededAt, values: workspace.values }));
      workspace.persistent = true;
      return true;
    } catch (error) {
      workspace.persistent = false;
      return false;
    }
  }

  function loadDemoWorkspace(storage, now) {
    var workspace;
    var recovered = false;
    try {
      var raw = storage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        try { workspace = JSON.parse(raw); }
        catch (error) { recovered = true; }
      }
    } catch (error) {
      workspace = memoryWorkspace ? clone(memoryWorkspace) : createDemoSeed(now);
      workspace.persistent = false;
      memoryWorkspace = clone(workspace);
      return workspace;
    }
    if (!isValidWorkspace(workspace)) {
      workspace = createDemoSeed(now);
      recovered = recovered || !!(storage && storage.getItem && storage.getItem(DEMO_STORAGE_KEY));
      writeWorkspace(storage, workspace);
    } else {
      workspace = clone(workspace);
      workspace.persistent = true;
    }
    if (recovered) workspace.recovered = true;
    memoryWorkspace = clone(workspace);
    return workspace;
  }

  function saveDemoValue(storage, key, value) {
    var workspace = loadDemoWorkspace(storage, new Date());
    workspace.values[key] = clone(value);
    writeWorkspace(storage, workspace);
    memoryWorkspace = clone(workspace);
    return workspace;
  }

  function resetDemoWorkspace(storage, now) {
    var workspace = createDemoSeed(now);
    writeWorkspace(storage, workspace);
    memoryWorkspace = clone(workspace);
    return workspace;
  }

  var DEMO_KEYWORDS = {
    "강남맛집": { pc: 36400, mobile: 90400, click: 72.3 },
    "서면맛집": { pc: 10800, mobile: 93400, click: 165.4 },
    "카페마케팅": { pc: 2960, mobile: 23700, click: 94 }
  };

  function demoKeywordResponse(mode, keywords) {
    var requested = (Array.isArray(keywords) ? keywords : [keywords]).map(function (keyword) {
      return String(keyword || "").replace(/\s/g, "");
    }).filter(Boolean);
    var names = mode === "related" && requested[0]
      ? [requested[0], "강남역맛집", "데이트맛집", "서울맛집"]
      : requested;
    var rows = names.map(function (name, index) {
      var item = DEMO_KEYWORDS[name] || { pc: 1200 + index * 430, mobile: 6800 + index * 910, click: 18.4 + index * 4.7 };
      return { relKeyword: name, monthlyPcQcCnt: item.pc, monthlyMobileQcCnt: item.mobile, monthlyAveMobileClkCnt: item.click, demo: true };
    });
    return { keywordList: rows, demo: true, notice: "데모 데이터 · 실제 네이버 수치가 아닙니다." };
  }

  function demoDataLabResponse(keyword, unit, startDate, endDate) {
    var end = endDate ? new Date(endDate + "T00:00:00") : localDay(new Date());
    var start = startDate ? new Date(startDate + "T00:00:00") : addCalendarDays(end, -30);
    var step = unit === "month" ? 30 : unit === "week" ? 7 : 1;
    var points = [];
    var cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var index = 0;
    while (cursor <= end && points.length < 370) {
      var wave = 62 + Math.sin(index * 1.25) * 17 + Math.cos(index * 0.42) * 9;
      points.push({ period: isoDate(cursor), ratio: Math.max(18, Math.min(100, Math.round(wave * 10) / 10)) });
      cursor = addCalendarDays(cursor, step);
      index += 1;
    }
    return { startDate: isoDate(start), endDate: isoDate(end), timeUnit: unit || "date", results: [{ title: String(keyword || "강남맛집"), keywords: [String(keyword || "강남맛집")], data: points }], demo: true, notice: "데모 데이터 · 실제 네이버 수치가 아닙니다." };
  }

  root.DemoData = {
    DEMO_STORAGE_KEY: DEMO_STORAGE_KEY,
    DEMO_SCHEMA_VERSION: DEMO_SCHEMA_VERSION,
    createDemoSeed: createDemoSeed,
    loadDemoWorkspace: loadDemoWorkspace,
    saveDemoValue: saveDemoValue,
    resetDemoWorkspace: resetDemoWorkspace,
    demoKeywordResponse: demoKeywordResponse,
    demoDataLabResponse: demoDataLabResponse
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
