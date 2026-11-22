"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatKoreaTime, safeErrorMessage, scheduleLabel } from "@/lib/validation";

type Course = {
  id: number;
  category: string;
  name: string;
  capacity: number;
  registered: number;
  startsAt: string;
  endsAt: string;
};
type Registration = { id: number; courseName: string; category: string; registeredAt: string };
type CategoryStatus = { name: string; courses: Omit<Course, "category">[] };
type StudentInfo = { studentNumber: string; name: string; studentCode: string };
type Panel = "none" | "mine" | "cancel" | "status";

const EMPTY_IDENTITY: StudentInfo = { studentNumber: "", name: "", studentCode: "" };

async function studentRequest(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch("/api/student", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? safeErrorMessage());
  return data;
}

export default function StudentHome() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Course | null>(null);
  const [step, setStep] = useState<"browse" | "course-code" | "identity" | "done">("browse");
  const [proof, setProof] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [identity, setIdentity] = useState<StudentInfo>(EMPTY_IDENTITY);
  const [panel, setPanel] = useState<Panel>("none");
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [status, setStatus] = useState<CategoryStatus[]>([]);
  const [statusCategory, setStatusCategory] = useState("");
  const [queryComplete, setQueryComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const categories = useMemo(() => [...new Set(courses.map((course) => course.category))], [courses]);
  const selectedCourses = useMemo(
    () => courses.filter((course) => course.category === category),
    [courses, category],
  );

  async function refreshCatalog() {
    try {
      const data = await studentRequest("catalog");
      setCourses(data.courses ?? []);
    } catch {
      setError("과목 정보를 불러오지 못했습니다. 잠시 후 새로고침해주세요.");
    }
  }

  useEffect(() => { void refreshCatalog(); }, []);

  function resetFlow() {
    setSelected(null);
    setCourseCode("");
    setProof("");
    setIdentity(EMPTY_IDENTITY);
    setStep("browse");
    setNotice("");
    setError("");
  }

  async function chooseCourse(course: Course) {
    setError("");
    if (scheduleLabel(course.startsAt, course.endsAt) === "신청 예정") {
      setSelected(course);
      setError("아직 수강신청 시간이 아닙니다");
      return;
    }
    if (scheduleLabel(course.startsAt, course.endsAt) === "마감") {
      setSelected(course);
      setError("신청 마감 시한이 지났습니다.");
      return;
    }
    setSelected(course);
    setCourseCode("");
    setIdentity(EMPTY_IDENTITY);
    setStep("course-code");
  }

  async function verifyCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const data = await studentRequest("verify_course", { courseId: selected.id, code: courseCode });
      setProof(data.proof);
      setCourseCode("");
      setIdentity(EMPTY_IDENTITY);
      setStep("identity");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : safeErrorMessage());
    } finally { setBusy(false); }
  }

  async function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const data = await studentRequest("register", { ...identity, courseId: selected.id, proof });
      setNotice(`${data.courseName} 신청이 완료되었습니다.`);
      setStep("done");
      await refreshCatalog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : safeErrorMessage());
    } finally { setBusy(false); }
  }

  async function withIdentity(action: "mine" | "status") {
    setBusy(true);
    setError("");
    try {
      const data = await studentRequest(action, identity);
      setQueryComplete(true);
      if (action === "mine") setRegistrations(data.registrations ?? []);
      else { setStatus(data.categories ?? []); setStatusCategory(""); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : safeErrorMessage());
    } finally { setBusy(false); }
  }

  async function cancelRegistration(registration: Registration) {
    if (!window.confirm(`${registration.courseName} 신청을 취소할까요?`)) return;
    setBusy(true);
    setError("");
    try {
      await studentRequest("cancel", { ...identity, registrationId: registration.id });
      setNotice(`${registration.courseName} 신청을 취소했습니다.`);
      await withIdentity("mine");
      await refreshCatalog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : safeErrorMessage());
    } finally { setBusy(false); }
  }

  async function openPanel(next: Panel) {
    setPanel(next);
    setIdentity(EMPTY_IDENTITY);
    setRegistrations([]);
    setStatus([]);
    setStatusCategory("");
    setQueryComplete(false);
    setError("");
    setNotice("");
  }

  async function refreshStatus() {
    await withIdentity("status");
    await refreshCatalog();
  }

  const identityForm = (onSubmit: (event: React.FormEvent<HTMLFormElement>) => void, button: string) => (
    <form className="form-grid" onSubmit={onSubmit}>
      <label>학번<input inputMode="numeric" autoComplete="off" maxLength={5} pattern="[0-9]{5}" required
        value={identity.studentNumber} onChange={(event) => setIdentity({ ...identity, studentNumber: event.target.value })} /></label>
      <label>이름<input autoComplete="name" maxLength={50} required
        value={identity.name} onChange={(event) => setIdentity({ ...identity, name: event.target.value })} /></label>
      <label>학생 전용 코드<input type="password" autoComplete="off" maxLength={72} required
        value={identity.studentCode} onChange={(event) => setIdentity({ ...identity, studentCode: event.target.value })} /></label>
      <button className="button primary" disabled={busy}>{busy ? "확인 중..." : button}</button>
    </form>
  );

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">Course registration</Link>
        <span className="topbar-note">수강신청 플랫폼</span>
      </header>

      <section className="hero">
        <div className="hero-art" aria-hidden="true">배움</div>
        <div className="hero-copy">
          <p className="eyebrow">새로운 학기의 시작</p>
          <h1>나의 가능성을 발견하는 시간</h1>
          <p className="hero-subtitle">새로운 배움. 나의 선택으로.</p>
        </div>
      </section>

      <section className="content-section" id="courses">
        <div className="section-heading">
          <div><p className="eyebrow">COURSES</p><h2>수강과목 살펴보기</h2></div>
          <button className="button subtle" onClick={() => void refreshCatalog()}>새로고침</button>
        </div>
        {!courses.length ? <p className="empty-state">현재 등록된 과목이 없습니다.</p> : (
          <>
            <div className="category-grid" aria-label="수강 과목 범주">
              {categories.map((item) => (
                <button key={item} className={`category-card ${category === item ? "selected" : ""}`}
                  aria-pressed={category === item} onClick={() => { setCategory(item); setError(""); }}>
                  <span>{item}</span><span className="category-count">{courses.filter((course) => course.category === item).length}개 과목</span>
                </button>
              ))}
            </div>
            {category && <div className="course-list" aria-live="polite">
              {selectedCourses.map((course) => {
                const label = scheduleLabel(course.startsAt, course.endsAt);
                return <article className="course-row" key={course.id}>
                  <div className="course-info">
                    <h3>{course.name}</h3>
                    <p>{label === "신청 예정" ? `신청 시작 ${formatKoreaTime(course.startsAt)}` : `신청 마감 ${formatKoreaTime(course.endsAt)}`}</p>
                    <p className="capacity-text">정원 {course.capacity}명</p>
                  </div>
                  <div className="course-action">
                    <span className={`status-pill ${label === "신청 가능" ? "open" : label === "마감" ? "closed" : "pending"}`}>{label}</span>
                    <button className="button primary small" onClick={() => void chooseCourse(course)}>
                      {label === "신청 예정" ? "신청 예정" : label === "신청 가능" ? "수강 신청하기" : "마감"}
                    </button>
                  </div>
                </article>;
              })}
            </div>}
          </>
        )}
      </section>

      <section className="tools-section" aria-label="학생용 수강 관리">
        <button className="tool-card" onClick={() => void openPanel("cancel")}><span className="tool-icon">↩</span><span><strong>기존 수강과목 취소하기</strong><small>신청한 과목을 확인하고 취소할 수 있어요.</small></span><span aria-hidden="true">→</span></button>
        <button className="tool-card" onClick={() => void openPanel("mine")}><span className="tool-icon">✓</span><span><strong>내가 신청한 과목 조회하기</strong><small>현재 신청 내역을 확인해요.</small></span><span aria-hidden="true">→</span></button>
        <button className="tool-card" onClick={() => void openPanel("status")}><span className="tool-icon">▤</span><span><strong>현재 수강현황 조회하기</strong><small>범주별 신청 현황을 확인해요.</small></span><span aria-hidden="true">→</span></button>
      </section>

      <footer className="footer"><span>Course registration</span><a href="/admin">관리자 로그인</a></footer>

      {(selected || panel !== "none") && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { resetFlow(); setPanel("none"); } }}>
        <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <button className="dialog-close" aria-label="닫기" onClick={() => { resetFlow(); setPanel("none"); }}>×</button>
          {selected && step === "browse" && <><p className="eyebrow">{selected.category}</p><h2 id="dialog-title">{selected.name}</h2></>}
          {selected && step !== "browse" && <>
            <p className="eyebrow">{selected.category}</p><h2 id="dialog-title">{selected.name}</h2>
            {step === "course-code" && <form className="form-grid" onSubmit={verifyCourse}>
              <p className="muted">담당 선생님에게 받은 과목 코드를 입력해주세요.</p>
              <label>과목 코드<input type="password" autoComplete="off" required maxLength={72} value={courseCode} onChange={(event) => setCourseCode(event.target.value)} /></label>
              <button className="button primary" disabled={busy}>{busy ? "확인 중..." : "과목 코드 확인"}</button>
            </form>}
            {step === "identity" && <>
              <p className="muted">학생 본인 정보를 입력해주세요.</p>
              {identityForm(submitRegistration, "수강 신청 완료")}
            </>}
            {step === "done" && <div className="success-panel"><span className="success-icon">✓</span><p>{notice}</p><button className="button primary" onClick={() => { resetFlow(); setPanel("none"); }}>확인</button></div>}
          </>}
          {panel !== "none" && <>
            <p className="eyebrow">학생 서비스</p>
            <h2 id="dialog-title">{panel === "mine" ? "내가 신청한 과목" : panel === "cancel" ? "수강과목 취소하기" : "현재 수강현황"}</h2>
            {registrations.length === 0 && status.length === 0 && notice === "" && !queryComplete &&
              identityForm((event) => { event.preventDefault(); void withIdentity(panel === "status" ? "status" : "mine"); }, panel === "status" ? "수강현황 조회" : "신청 내역 조회")}
            {error && <p className="notice error" role="alert">{error}</p>}
            {notice && <p className="notice success" role="status">{notice}</p>}
            {panel !== "status" && registrations.length > 0 && <div className="result-list">
              {registrations.map((registration) => <article className="result-row" key={registration.id}>
                <div><span className="eyebrow">{registration.category}</span><strong>{registration.courseName}</strong><small>신청 {formatKoreaTime(registration.registeredAt)}</small></div>
                {panel === "cancel" && <button className="button danger small" onClick={() => void cancelRegistration(registration)}>신청 취소</button>}
              </article>)}
            </div>}
            {panel !== "status" && queryComplete && registrations.length === 0 && !error &&
              <p className="empty-state">현재 신청한 과목이 없습니다.</p>}
            {panel !== "status" && (registrations.length > 0 || (identity.studentNumber && !error && !busy)) &&
              <button className="button subtle refresh-inline" onClick={() => void withIdentity("mine")}>새로고침</button>}
            {panel === "status" && status.length > 0 && <>
              <div className="status-toolbar"><button className="button subtle" onClick={() => void refreshStatus()}>새로고침</button></div>
              {!statusCategory ? <div className="category-grid compact">
                {status.map((item) => <button className="category-card" key={item.name} onClick={() => setStatusCategory(item.name)}>
                  <span>{item.name}</span><span className="category-count">{item.courses.length}개 과목</span>
                </button>)}
              </div> : <div className="result-list">
                <button className="text-button" onClick={() => setStatusCategory("")}>← 범주 목록</button>
                <h3>{statusCategory}</h3>
                {(status.find((item) => item.name === statusCategory)?.courses ?? []).map((course) => {
                  const label = scheduleLabel(course.startsAt, course.endsAt);
                  return <article className="course-row status-row" key={course.id}>
                    <div className="course-info"><h3>{course.name}</h3><p>신청 {course.registered} / {course.capacity}명</p>
                      <p>{label === "신청 예정" ? `신청 시작 ${formatKoreaTime(course.startsAt)}` : `신청 마감 ${formatKoreaTime(course.endsAt)}`}</p></div>
                    <span className={`status-pill ${label === "신청 가능" ? "open" : label === "마감" ? "closed" : "pending"}`}>{label}</span>
                  </article>;
                })}
              </div>}
            </>}
            {panel === "status" && queryComplete && status.length === 0 && !error &&
              <p className="empty-state">현재 등록된 과목이 없습니다.</p>}
          </>}
          {error && panel === "none" && <p className="notice error" role="alert">{error}</p>}
        </section>
      </div>}
    </main>
  );
}
