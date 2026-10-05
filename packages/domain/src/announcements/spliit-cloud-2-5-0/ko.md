---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0이 출시되었습니다
inApp: true
email: true
---

Spliit Cloud 2.5.0이 출시되었습니다. 이번 버전의 새로운 소식과 최근에 놓쳤을 수 있는 기능들을 정리해 소개합니다. 앞으로도 이 방식으로는 새 기능과 중요한 공지만 공유하고, 수시로 배포되는 작은 패치와 수정 사항은 포함하지 않습니다.

## 활동 탭이 이제 나에게 맞춰 표시됩니다

활동 탭이 지출 타임라인과 같은 방식으로 표시됩니다. 나와 상관없는 활동은 인라인 행으로 묶어 숨기는 나에게만 / 전체 전환 기능이 추가되었고, 모든 지출에는 내 부담액이 별도의 내 부담액: 줄에 표시됩니다. 자세한 내용은 [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) 노트를 확인하세요.

## 48시간 안전장치와 함께하는 계정 삭제

계정 설정에 새로운 위험 구역과 전용 검토 페이지가 추가되었습니다. 그룹별 영향을 확인하고, 이름과 남은 잔액 처리 방식을 선택한 뒤 삭제를 입력하면 예약됩니다. 계정은 48시간 동안 활성 상태로 유지되며 언제든 취소할 수 있습니다. 자세한 내용은 [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0) 노트를 확인하세요.

## 훨씬 빨라진 분류와 그룹 도구에서의 일괄 정리

지출 분류가 LLM 기반 약 3초에서 Jev 결정 모델 기반 약 250ms로 빨라졌고, 확실하지 않은 추측은 한 번의 탭으로 적용되는 제안 칩으로 표시됩니다. 그룹 전체를 정리해야 할 때는 그룹 도구의 [일괄 분류](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0)에서 제안을 검토하고 한꺼번에 저장하세요. 자세한 내용은 [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) 및 [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) 노트를 확인하세요.

## 거의 모든 은행·카드 CSV 가져오기

은행 명세서나 카드 내역을 업로드해 기존 지출을 가져오세요. [일반 CSV 가져오기](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0)는 실시간 미리보기로 열을 매핑하고, 카테고리를 매핑한 뒤, 저장 전에 중복을 표시합니다.

## 게스트를 포함한 모든 계정의 패스키

비밀번호 대신 지문, 얼굴, 보안 키로 로그인하세요. 패스키는 이메일, 소셜, 게스트 계정에서 사용할 수 있으며, 익명 계정에서는 복구 링크 대신 사용하기에도 좋습니다. [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0) 노트를 확인하세요.

## 방 전체 초대를 몇 초 만에

방 전체가 함께 사용할 수 있는 스캔 전용 QR 코드 하나를 공유하세요. 15분 동안 유효하며 누가 참여했는지 실시간 목록으로 확인할 수 있습니다. 게스트는 휴대폰 카메라나 스캔하여 참여 동작으로도 참여할 수 있습니다. [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) 노트를 확인하세요.

## 나와 관련된 것만 보여주는 차분한 앱

타임라인에서 나와 상관없는 지출과 활동을 인라인 행으로 묶어 숨기고, 나에게만 / 전체 전환으로 볼 수 있습니다. 그룹 탭 순서를 직접 정하고 쓰지 않는 탭을 숨기며, 지출 상세에서 참여자별 항목별 내역을 보고, 모바일에서는 큰 스크롤 휠로 시간을 선택할 수 있습니다. [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) 및 [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1) 노트를 확인하세요.

## 데이터를 함께 가져가세요

그룹과 계정의 전체 ZIP 왕복 백업은 물론, CSV와 인쇄용 PDF 보고서도 내보낼 수 있습니다. 가져오기와 내보내기에 대한 내용은 [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) 노트를 확인하세요.

## 그룹마다 알아보기 쉽게

이모지와 색상으로 그룹마다 고유한 스타일을 지정하면 카드, 목록, 앰비언트 배경에 표시됩니다. [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) 노트를 확인하세요.

## 개발자를 위한 기능: 아웃바운드 웹훅

지출 생성, 수정, 삭제를 서명된 이벤트로 본인의 HTTPS 엔드포인트에 전송합니다. 재시도, 전송 기록, 재전송을 지원합니다. 설정 방법은 [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0) 노트를 확인하세요.
