# Phase 5: AWS 실서비스 배포 계획

## 서비스 특성 분석

| 항목 | 내용 |
|------|------|
| 서버 사이드 로직 | API Route 1개 (OpenAI Vision 프록시) |
| 클라이언트 사이드 | 상태관리, DnD, SA 알고리즘, 효과 계산 **전부** |
| 정적 데이터 | 295개 이미지 (421KB), 241 아티팩트 + 54 석판 JSON |
| DB | 없음 (Phase 1) |
| 인증 | 없음 (Phase 1) |
| 대상 사용자 | 한국 게임 커뮤니티 |

**핵심 인사이트**: 연산의 99%가 클라이언트에서 실행된다. 서버는 OpenAI 프록시 역할만 한다.
→ **서버리스/엣지 배포에 최적화된 구조**

---

## 1. AWS 배포 옵션 비교

### 비용 비교 (월간 USD, 한국 리전 ap-northeast-2)

| 트래픽 | Amplify | SST (OpenNext) | ECS Fargate | EC2 |
|--------|---------|----------------|-------------|-----|
| 100 DAU | **$0.5~1** | $0.5~1.5 | $27~36 | $8~16 |
| 500 DAU | **$2~5** | $2~5 | $30~50 | $12~26 |
| 2,000 DAU | $8~15 | **$5~12** | $35~55 | $15~30 |
| 10,000 DAU | $25~50 | **$15~40** | $50~80 | $25~50 |

### Option A: AWS Amplify Hosting (추천 - Phase 1)

```
[GitHub] → push → [AWS Amplify]
                      ├── CloudFront CDN (정적 자산 + 이미지)
                      └── Lambda@Edge (API Route 1개)
```

| 장점 | 단점 |
|------|------|
| 30분 내 배포 완료 | Lambda 설정 제한 (타임아웃 등) |
| 내장 CI/CD (Git push → 자동 배포) | Next.js 최신 기능 지원 약간 느림 |
| 무료 티어로 초기 비용 $0 | CloudFront 세밀 제어 불가 |
| 자동 SSL, CDN, 스케일링 | WAF 직접 연결 불가 |
| 환경 변수 관리 내장 | |

**무료 티어**: 빌드 1,000분/월, 15GB 전송/월, SSR 500K 요청/월

### Option B: SST (OpenNext) + Lambda + CloudFront (추천 - Phase 2)

```
[GitHub Actions] → [SST Deploy]
                      ├── S3 (정적 자산)
                      ├── CloudFront (CDN + WAF)
                      └── Lambda (API Route, 커스텀 설정 가능)
```

| 장점 | 단점 |
|------|------|
| Infrastructure-as-Code 완전 제어 | 초기 설정 2~4시간 |
| Lambda 타임아웃/메모리 커스텀 | SST/CDK 학습 필요 |
| WAF, Rate Limiting 연결 용이 | CI/CD 별도 구성 |
| DynamoDB, Cognito 한 줄로 추가 | OpenNext 호환성 이슈 가능 |
| 대규모 시 Amplify보다 저렴 | |

### Option C & D: ECS Fargate / EC2

**비추천**. API Route 1개를 위해 컨테이너나 서버를 상시 운영하는 것은 과도한 설계.
ECS Fargate는 ALB 고정 비용만 월 $16, EC2는 단일 장애점 + 수동 관리 부담.

---

## 2. 추천 아키텍처: 2단계 전략

### Phase 1: Amplify (즉시 ~ DAU 2,000)

```
┌──────────────┐
│   사용자       │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────────────────────────────┐
│          AWS CloudFront (CDN)         │
│  ap-northeast-2 (Seoul Edge)          │
├───────────────┬──────────────────────┤
│ 정적 자산      │ SSR / API Route      │
│ - JS 번들     │ - /api/analyze-      │
│ - CSS         │   inventory          │
│ - 295 이미지   │   (Lambda@Edge)      │
│ - 정적 HTML   │                      │
│ (S3 자동)     │  → OpenAI gpt-4o     │
└───────────────┴──────────────────────┘
         │
         │ AWS Amplify (관리형)
         │ - Git push 자동 배포
         │ - 환경 변수 (OPENAI_API_KEY)
         │ - 프리뷰 환경 (develop 브랜치)
         │
┌────────┴────────┐
│  GitHub Repo     │
│  (소스 코드)     │
└─────────────────┘
```

**예상 월 비용 (초기)**: **$0 ~ $5** (무료 티어 + OpenAI API 비용 별도)

### Phase 2: SST 마이그레이션 (DAU 2,000+ 또는 기능 확장 시)

마이그레이션 트리거:
- 빌드 공유/저장 기능 추가 → DynamoDB 필요
- 사용자 인증 추가 → Cognito 또는 NextAuth
- WAF/Rate Limiting 인프라 레벨 필요
- Lambda 타임아웃 커스텀 필요 (Vision API 30초+ 응답)
- 월 Amplify 비용 $30 초과

```
┌──────────────┐
│   사용자       │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│  CloudFront + AWS WAF                         │
│  - Rate Limiting (100 req/5min per IP)        │
│  - Geo 제한 (선택)                             │
├──────────────┬──────────────┬────────────────┤
│ S3 Bucket    │ Lambda       │ Lambda         │
│ (정적 자산)   │ (SSR)        │ (API Route)    │
│              │              │ 메모리: 512MB   │
│              │              │ 타임아웃: 60초   │
│              │              │ → OpenAI        │
└──────────────┴──────────────┴────────┬───────┘
                                       │
                              ┌────────┴────────┐
                              │  DynamoDB        │
                              │  (빌드 저장)      │
                              └────────┬────────┘
                              ┌────────┴────────┐
                              │  Upstash Redis   │
                              │  (Rate Limit)    │
                              └─────────────────┘
```

---

## 3. 프로덕션 필수 보강 사항

### 3.1 API Rate Limiting (최우선)

OpenAI gpt-4o Vision 호출 1건 ≈ $0.01~0.03. 무제한 노출 시 비용 폭탄 위험.

**즉시 구현 (앱 레벨)**:
```typescript
// app/api/analyze-inventory/route.ts
// @upstash/ratelimit 사용 (서버리스 호환, 무료 10K 커맨드/일)
// 제한: IP당 10회/시간, 100회/일
```

**Phase 2 (인프라 레벨)**:
- AWS WAF Rate-based Rule: IP당 100 요청/5분
- WAF 비용: $5/월 + $0.60/백만 요청

**OpenAI 측 보호**:
- OpenAI 대시보드에서 월간 사용 한도 설정 ($50 하드캡)
- AWS Budget 알람: $10, $50, $100 경고

### 3.2 이미지 호스팅 전략

| 옵션 | 설명 | 추천 |
|------|------|------|
| A. 외부 URL 유지 | `img.sephiria.wiki` 핫링크 | 의존성 리스크 |
| **B. `/public` 번들** | Next.js 프로젝트에 포함 | **추천** |
| C. S3 + CloudFront 분리 | 별도 CDN | 421KB에 과도 |

**추천: Option B** — 전체 이미지가 421KB (평균 1.4KB/개)로 극히 작음.
- `public/images/artifacts/`, `public/images/slabs/`에 배치
- `next/image`로 자동 WebP 변환 + lazy loading
- 외부 서비스 의존 제거

### 3.3 환경 변수 & 시크릿

```env
# .env.local (Git 제외)
OPENAI_API_KEY=sk-...              # 서버 전용

# .env (Git 포함 가능)
NEXT_PUBLIC_APP_URL=https://sephiria-optimizer.com
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX     # 선택
```

**Amplify**: Amplify Console → Environment Variables에 `OPENAI_API_KEY` 등록 (암호화)
**SST**: `sst.Secret` → AWS SSM Parameter Store (SecureString)

### 3.4 보안 헤더 (next.config.js)

```javascript
headers: [
  {
    source: '/:path*',
    headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      {
        key: 'Content-Security-Policy',
        value: "default-src 'self'; script-src 'self' 'unsafe-eval'; " +
               "style-src 'self' 'unsafe-inline'; " +
               "img-src 'self' data: blob:; " +
               "connect-src 'self' https://api.openai.com; " +
               "worker-src 'self' blob:;"  // Web Worker 필수
      }
    ]
  }
]
```

### 3.5 에러 모니터링

**추천: Sentry (무료 5K 에러/월)**

모니터링 포인트:
- OpenAI API 실패 (타임아웃, 429, 500)
- Web Worker 크래시 (SA 옵티마이저)
- React 에러 바운더리
- 클라이언트 effectEngine 계산 오류

**대안**: AWS CloudWatch (Amplify Lambda 로그 무료, 수동 파싱 필요)

### 3.6 리전 선택

**ap-northeast-2 (서울)** — 한국 게임 커뮤니티 대상, 최저 레이턴시.
- us-east-1 대비 약 10% 높은 AWS 가격이지만 사용자 경험 우선.
- CloudFront 엣지는 어차피 글로벌 배포.

---

## 4. CI/CD 파이프라인

### Phase 1: Amplify 내장 CI/CD

Amplify가 Git push 시 자동 빌드/배포. 추가로 GitHub Actions에서 품질 검증만 수행:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint           # ESLint
      - run: npm run type-check     # tsc --noEmit
      - run: npm run test           # effectEngine 단위 테스트 (핵심!)
      - run: npm run build          # 빌드 검증
```

### Phase 2: SST 배포 파이프라인

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # AWS OIDC
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'npm' }
      - run: npm ci
      - run: npm run lint && npm run type-check && npm run test
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-arn: arn:aws:iam::ACCOUNT:role/GitHubActionsRole
          aws-region: ap-northeast-2
      - run: npx sst deploy --stage production
```

### 브랜치 전략

```
main        → 프로덕션 자동 배포
develop     → 프리뷰 환경 (Amplify Preview)
feature/*   → CI만 실행 (lint, test, build)
```

---

## 5. 향후 확장 계획

### 5.1 빌드 공유/저장 (DynamoDB)

```
Table: sephiria-builds
  PK: buildId (nanoid)
  Attributes: slots (JSON), slotNum, metadata, createdAt
  GSI: createdAt (최근 빌드 목록)
  TTL: expiresAt (30일 자동 삭제, 선택)
```

- 온디맨드 가격: 쓰기 $1.25/백만, 읽기 $0.25/백만
- 1,000 공유/일 ≈ **$0.04/월**
- 무료 티어: 25GB 저장, 25 WCU/RCU

### 5.2 사용자 인증

**NextAuth.js + Discord OAuth** (게임 커뮤니티 최적)
- Discord OAuth: 무료, 게임 커뮤니티 자연스러운 연동
- 세션 저장: DynamoDB 어댑터 (빌드 공유 테이블과 같은 인스턴스)
- 추가 비용: $0

### 5.3 트래픽 급증 대응 (유명 스트리머 소개 등)

**보호 대상은 AWS가 아니라 OpenAI 비용**:
- 정적 자산 + 클라이언트 연산 → CDN/브라우저에서 처리, 무한 확장
- API Route(Vision) → OpenAI 비용이 병목
- 대응: 예산 하드캡 ($100/월) + 수동 입력 모드가 완전한 폴백

---

## 6. 예상 총 비용 요약

### Phase 1 (런칭 ~ 6개월)

| 항목 | 월 비용 |
|------|---------|
| AWS Amplify | $0~5 (무료 티어 포함) |
| 도메인 (Route 53) | $1 (등록 연 $12) |
| OpenAI API | $5~30 (사용량 따라) |
| Sentry | $0 (무료 티어) |
| Upstash Redis | $0 (무료 티어) |
| **합계** | **$6~36/월** |

### Phase 2 (확장 시)

| 항목 | 월 비용 |
|------|---------|
| SST (Lambda + CloudFront + S3) | $5~40 |
| DynamoDB | $0~5 |
| AWS WAF | $5~10 |
| 도메인 | $1 |
| OpenAI API | $10~100 |
| Sentry | $0 |
| **합계** | **$21~156/월** |

---

## 7. Amplify 즉시 배포 체크리스트

```
[ ] GitHub 레포지토리 생성 & 코드 push
[ ] AWS 계정 생성 + Amplify Console 접속
[ ] Amplify → New App → GitHub 연결 → main 브랜치 선택
[ ] 빌드 설정 확인 (Next.js 14 App Router 자동 감지)
[ ] 환경 변수 등록: OPENAI_API_KEY
[ ] 커스텀 도메인 연결 (선택)
[ ] 첫 배포 확인
[ ] OpenAI 대시보드에서 월간 사용 한도 $50 설정
[ ] Sentry 연동 (선택)
[ ] Google Analytics 연동 (선택)
```
