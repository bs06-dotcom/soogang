# Course registration

학생이 회원 가입 없이 과목 코드와 학생 전용 코드로 수강 신청하고, 관리자는 Supabase Auth 계정으로 운영하는 한국어 수강신청 서비스입니다.

## 실행

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

`.env.local`에는 Supabase 프로젝트 URL과 **publishable key**만 넣습니다. `service_role` 또는 Secret API key는 브라우저, 서버 코드, 배포 환경 어디에도 사용하지 않습니다.

## Supabase 초기 설정

프로젝트에 `supabase/migrations/202611210001_course_registration.sql`을 적용합니다. 마이그레이션은 `private` 스키마에 학생·과목·신청·증표 데이터를 저장하고, RLS와 REST 직접 접근 차단을 설정합니다. 공개 RPC는 학생 기능과 관리자 기능만 허용하며 관리자 RPC는 로그인 UUID의 허용 목록을 매번 검사합니다.

Supabase Auth에서 이메일/비밀번호 로그인을 활성화하고 이메일 확인을 켭니다. `/admin`에서 `bs06@gmail.com`으로 최초 계정을 만들고 확인 메일을 승인하면 DB 트리거가 해당 Auth UUID만 관리자 허용 목록에 등록합니다. 다른 이메일로 만든 계정은 관리자 기능을 사용할 수 없습니다. 학생 명단은 관리자 화면의 엑셀 업로드에서 등록합니다.

학생 명단 양식은 `.xlsx`, 2MB 이하, 최대 3,000명입니다. 첫 행의 열 이름은 `학번`, `이름`, `전용코드`이며 데이터 행 번호를 보존해 검증합니다. 학생·과목 전용 코드는 bcrypt 입력 한도에 맞춰 UTF-8 기준 1~72바이트로 제한합니다. 저장 전에 파일 전체를 검증하며, 업로드되지 않은 기존 학생은 삭제하지 않습니다.

## 배포

GitHub `main` 브랜치를 Vercel 프로젝트에 연결하고 아래 환경변수를 Preview/Production에 설정합니다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

학생 페이지는 공개되고, `/admin`은 앱에서 Supabase Auth와 DB 관리자 허용 목록으로 보호합니다. 서비스 데이터베이스 시간은 `timestamptz`로 저장하며 화면 입력/표시는 `Asia/Seoul`을 사용합니다.

## 보안 및 동시 신청

- 학생 명단, 비밀번호 해시, 관리자 목록, 과목 코드 해시, 증표 및 신청 기록은 비공개 스키마에 저장됩니다.
- 학생 전용 코드와 과목 코드는 bcrypt 해시로만 저장되고, 과목 코드 검증 증표는 임의 토큰의 SHA-256 해시로 저장되어 10분 후 만료됩니다.
- 신청 RPC는 학생별 advisory transaction lock을 먼저 얻고 과목 행을 잠근 후 정원, 전체 한도, 범주 한도를 확인합니다. 활성 신청에는 부분 유니크 인덱스가 적용됩니다.
- 관리자 기능은 유효한 Supabase JWT와 관리자 UUID allow-list를 모두 확인합니다.
- 학생 요청은 학번별, 과목 코드 검증은 과목별로 분당 제한하며, 오류 응답은 고정된 한국어 메시지로 제한합니다.
- 실제 학생 명단은 저장소에서 제외하며, `.env*`도 Git에서 제외됩니다.

## 확인

```powershell
npm test
npm run lint
npm run build
```
