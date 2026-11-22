"use client";

import ExcelJS from "exceljs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabaseClient } from "@/lib/supabase";
import { formatKoreaTime, isValidSecretCode, normalizeStudentNumber, scheduleLabel, validateRosterRows, type RosterRow } from "@/lib/validation";
import { koreaLocalToIso } from "@/lib/time";

type Course = {
  id: number; category: string; name: string; capacity: number; registered: number;
  startsAt: string; endsAt: string;
};
type Registration = { id: number; number: string; name: string; registeredAt: string };
type CategoryLimit = { name: string; limit: number };
type ArchiveCourse = { id: number; category: string; name: string; deletedAt: string; registrationCount: number };
type Tab = "courses" | "roster" | "students" | "archive" | "limits" | "account";

const EMPTY_COURSE = { category: "주제선택", name: "", code: "", capacity: "20", startsAt: "", endsAt: "" };

function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string) {
  void workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  });
}

function excelTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export default function AdminPanel() {
  const supabase = useMemo(() => {
    try {
      return getBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [tab, setTab] = useState<Tab>("courses");
  const [courses, setCourses] = useState<Course[]>([]);
  const [archive, setArchive] = useState<ArchiveCourse[]>([]);
  const [categories, setCategories] = useState<CategoryLimit[]>([]);
  const [stats, setStats] = useState({ courseCount: 0, studentCount: 0, registrationCount: 0, totalLimit: 4 });
  const [courseForm, setCourseForm] = useState(EMPTY_COURSE);
  const [courseRosterId, setCourseRosterId] = useState("");
  const [roster, setRoster] = useState<Registration[]>([]);
  const [archiveId, setArchiveId] = useState("");
  const [archiveRoster, setArchiveRoster] = useState<Registration[]>([]);
  const [searchNumber, setSearchNumber] = useState("");
  const [searchedStudent, setSearchedStudent] = useState<{ number: string; name: string } | null>(null);
  const [studentRegistrations, setStudentRegistrations] = useState<Array<Registration & { category: string; courseName: string }>>([]);
  const [categoryLimitDraft, setCategoryLimitDraft] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState("");
  const [newCategoryLimit, setNewCategoryLimit] = useState("1");
  const [totalLimitDraft, setTotalLimitDraft] = useState("4");
  const [emailDraft, setEmailDraft] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [rosterErrors, setRosterErrors] = useState<Array<{ rowNumber: number; reason: string }>>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (!supabase) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("관리자 로그인이 필요합니다.");
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, payload }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
    return data;
  }, [supabase]);

  const refresh = useCallback(async () => {
    const [dashboard, courseData, categoryData, archiveData] = await Promise.all([
      request("dashboard"), request("courses"), request("category_limits"), request("archive"),
    ]);
    setStats(dashboard);
    setCourses(courseData.courses ?? []);
    setCategories(categoryData.categories ?? []);
    setTotalLimitDraft(String(categoryData.totalLimit ?? 4));
    setArchive(archiveData.courses ?? []);
    setCategoryLimitDraft(Object.fromEntries((categoryData.categories ?? []).map((item: CategoryLimit) => [item.name, String(item.limit)])));
  }, [request]);

  async function verifyAdmin() {
    try {
      await request("dashboard");
      setError("");
      await refresh();
    } catch {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setError("이 계정은 관리자 권한이 없습니다.");
    } finally { setAuthLoading(false); }
  }

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setUser(data.session.user);
        void verifyAdmin();
      } else setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  // verify once after initial session; request and refresh use stable callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (!supabase) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
      if (authMode === "signup") {
        if (authEmail.trim().toLowerCase() !== "bs06@gmail.com") throw new Error("관리자 이메일만 계정을 만들 수 있습니다.");
        const { data, error: authError } = await supabase.auth.signUp({
          email: authEmail.trim(),
          password: authPassword,
        });
        if (authError) throw new Error(authError.message === "User already registered"
          ? "이미 등록된 계정입니다. 로그인 화면으로 이동해 비밀번호를 입력해주세요."
          : "관리자 계정을 등록하지 못했습니다. 이메일과 비밀번호를 확인해주세요.");
        if (data.session) {
          setUser(data.user);
          await verifyAdmin();
        } else {
          setMessage("관리자 계정을 등록했습니다. 로그인 화면으로 이동해 로그인해주세요.");
          setAuthMode("login");
        }
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
        if (authError || !data.user) throw new Error("이메일 또는 비밀번호를 확인해주세요.");
        setUser(data.user);
        await verifyAdmin();
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "로그인하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function run(action: () => Promise<void>, success?: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (success) setMessage(success); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function createCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!isValidSecretCode(courseForm.code)) {
        throw new Error("과목 코드는 UTF-8 기준 1~72바이트여야 합니다.");
      }
      await request("create_course", {
        ...courseForm,
        capacity: Number(courseForm.capacity),
        startsAt: koreaLocalToIso(courseForm.startsAt),
        endsAt: koreaLocalToIso(courseForm.endsAt),
      });
      setCourseForm(EMPTY_COURSE);
      await refresh();
    }, "과목을 등록했습니다.");
  }

  async function loadRoster(courseId: string) {
    setCourseRosterId(courseId); setRoster([]);
    if (!courseId) return;
    await run(async () => {
      const data = await request("course_roster", { courseId: Number(courseId) });
      setRoster(data.registrations ?? []);
    });
  }

  async function loadArchive(courseId: string) {
    setArchiveId(courseId); setArchiveRoster([]);
    if (!courseId) return;
    await run(async () => {
      const data = await request("archive_roster", { courseId: Number(courseId) });
      setArchiveRoster(data.registrations ?? []);
    });
  }

  async function loadStudent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const data = await request("search_student", { studentNumber: searchNumber });
      setSearchedStudent(data.student);
      setStudentRegistrations(data.registrations ?? []);
    });
  }

  async function uploadRoster(file?: File) {
    setRosterErrors([]);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) { setRosterErrors([{ rowNumber: 0, reason: ".xlsx 파일만 업로드할 수 있습니다." }]); return; }
    if (file.size > 2 * 1024 * 1024) { setRosterErrors([{ rowNumber: 0, reason: "파일 크기는 2MB 이하여야 합니다." }]); return; }
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("엑셀 시트를 찾을 수 없습니다.");
      const expected = ["학번", "이름", "전용코드"];
      const header = [1, 2, 3].map((column) => String(sheet.getCell(1, column).text).trim());
      if (header.some((value, index) => value !== expected[index])) {
        setRosterErrors([{ rowNumber: 1, reason: "첫 행의 열 이름은 학번, 이름, 전용코드 순서여야 합니다." }]);
        return;
      }
      const rows: RosterRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const raw = [1, 2, 3].map((column) => row.getCell(column).text.trim());
        if (raw.every((value) => !value)) return;
        rows.push({ rowNumber, studentNumber: normalizeStudentNumber(raw[0]), name: raw[1], studentCode: raw[2] });
      });
      if (rows.length > 3000) { setRosterErrors([{ rowNumber: 0, reason: "학생은 한 번에 최대 3,000명까지 등록할 수 있습니다." }]); return; }
      const invalid = validateRosterRows(rows);
      if (invalid.length) { setRosterErrors(invalid); return; }
      await run(async () => {
        await request("import_students", { students: rows.map(({ studentNumber, name, studentCode }) => ({ studentNumber, name, studentCode })) });
        await refresh();
      }, `${rows.length}명의 학생 정보를 반영했습니다.`);
    } catch {
      setRosterErrors([{ rowNumber: 0, reason: "엑셀 파일을 읽지 못했습니다. .xlsx 양식을 확인해주세요." }]);
    }
  }

  function downloadTemplate() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("학생 등록");
    sheet.addRow(["학번", "이름", "전용코드"]);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    sheet.columns = [{ width: 14 }, { width: 18 }, { width: 24 }];
    downloadWorkbook(workbook, "학생등록_양식.xlsx");
  }

  function downloadRegistrations(title: string, rows: Array<Record<string, string>>, cancelled = false) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("신청 명단");
    sheet.addRow(cancelled ? ["순번", "학번", "이름", "신청 시각", "상태"] : ["순번", "학번", "이름", "신청 시각"]);
    rows.forEach((item, index) => sheet.addRow(cancelled
      ? [index + 1, item.number, item.name, excelTime(item.registeredAt), item.status]
      : [index + 1, item.number, item.name, excelTime(item.registeredAt)]));
    sheet.columns = [{ width: 9 }, { width: 12 }, { width: 18 }, { width: 24 }, { width: 12 }];
    downloadWorkbook(workbook, `${title}_신청명단.xlsx`);
  }

  async function downloadCourseRoster() {
    await run(async () => {
      const data = await request("course_roster", { courseId: Number(courseRosterId) });
      downloadRegistrations(data.course, data.registrations);
      setRoster(data.registrations);
    });
  }

  async function downloadArchiveRoster() {
    const selected = archive.find((item) => item.id === Number(archiveId));
    if (!selected) return;
    await run(async () => {
      const data = await request("archive_roster", { courseId: Number(archiveId) });
      downloadRegistrations(data.course, data.registrations, true);
      setArchiveRoster(data.registrations);
    });
  }

  if (authLoading) return <main className="admin-shell"><p className="loading">관리자 권한 확인 중...</p></main>;
  if (!user) return <main className="admin-shell auth-shell">
    <Link className="brand" href="/">Course registration</Link>
    <section className="auth-card">
      <Link className="back-link" href="/">← 학생 페이지</Link>
      <p className="eyebrow">ADMIN</p><h1>관리자 로그인</h1>
      <p className="muted">등록된 관리자 계정으로 로그인해주세요.</p>
      <form className="form-grid" onSubmit={signIn}>
        <label>이메일<input type="email" autoComplete="username" placeholder="관리자 이메일을 입력해주세요" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
        <label>비밀번호<input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} required minLength={8} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /></label>
        <button className="button primary" disabled={busy}>{busy ? "처리 중..." : authMode === "login" ? "로그인" : "관리자 계정 만들기"}</button>
      </form>
      <button className="text-button auth-switch" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setError(""); }}>
        {authMode === "login" ? "최초 관리자 계정 등록" : "로그인으로 돌아가기"}
      </button>
      {message && <p className="notice success" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) &&
        <p className="notice error">Supabase 환경변수가 설정되지 않았습니다.</p>}
    </section>
  </main>;

  const tabNames: Array<[Tab, string]> = [
    ["courses", "과목 관리"], ["roster", "등록현황"], ["students", "학생별 신청"],
    ["archive", "삭제 과목 보관함"], ["limits", "신청 제한"], ["account", "계정 설정"],
  ];

  return <main className="admin-shell">
    <header className="admin-topbar"><Link className="brand" href="/">Course registration</Link><div className="admin-user"><span>{user.email}</span><button className="button subtle small" onClick={() => void run(async () => { await supabase?.auth.signOut(); setUser(null); })}>로그아웃</button></div></header>
    <section className="admin-heading"><div><p className="eyebrow">ADMIN CONSOLE</p><h1>관리자 대시보드</h1></div><button className="button subtle" onClick={() => void run(refresh)}>새로고침</button></section>
    <section className="stats-grid" aria-label="운영 현황">
      <article className="stat-card"><span>운영 중인 과목</span><strong>{stats.courseCount}<small> / 20</small></strong></article>
      <article className="stat-card"><span>등록 학생</span><strong>{stats.studentCount}</strong></article>
      <article className="stat-card"><span>현재 신청 건수</span><strong>{stats.registrationCount}</strong></article>
      <article className="stat-card"><span>학생당 신청 한도</span><strong>{stats.totalLimit}<small> 과목</small></strong></article>
    </section>
    {(message || error) && <p className={`notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || message}</p>}
    <nav className="admin-tabs" aria-label="관리 메뉴">
      {tabNames.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setError(""); setMessage(""); }}>{label}</button>)}
    </nav>

    {tab === "courses" && <section className="admin-panel">
      <div className="section-heading"><div><h2>과목 등록</h2><p className="muted">신청 기간은 한국 시간(Asia/Seoul)으로 입력합니다.</p></div></div>
      <form className="course-form" onSubmit={createCourse}>
        <label>범주<input list="category-suggestions" required maxLength={40} value={courseForm.category} onChange={(event) => setCourseForm({ ...courseForm, category: event.target.value })} /></label>
        <datalist id="category-suggestions">{categories.map((item) => <option key={item.name} value={item.name} />)}</datalist>
        <label>과목명<input required maxLength={80} value={courseForm.name} onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })} /></label>
        <label>과목 코드<input type="password" autoComplete="new-password" required maxLength={72} value={courseForm.code} onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })} /></label>
        <label>제한 인원<input type="number" min={1} max={10000} required value={courseForm.capacity} onChange={(event) => setCourseForm({ ...courseForm, capacity: event.target.value })} /></label>
        <label>신청 시작 일시<input type="datetime-local" required value={courseForm.startsAt} onChange={(event) => setCourseForm({ ...courseForm, startsAt: event.target.value })} /></label>
        <label>신청 마감 일시<input type="datetime-local" required value={courseForm.endsAt} onChange={(event) => setCourseForm({ ...courseForm, endsAt: event.target.value })} /></label>
        <button className="button primary" disabled={busy || stats.courseCount >= 20}>과목 등록</button>
      </form>
      <div className="section-heading admin-list-heading"><div><h2>운영 중인 과목</h2><p className="muted">과목을 삭제하면 학생 화면에서 제외되고 보관함에 남습니다.</p></div></div>
      <div className="admin-course-list">
        {courses.map((course) => {
          const label = scheduleLabel(course.startsAt, course.endsAt);
          return <article className="admin-course-row" key={course.id}>
            <div className="admin-course-main"><span className="eyebrow">{course.category}</span><h3>{course.name}</h3><span className="muted">신청 {course.registered} / {course.capacity}명</span></div>
            <div className="admin-course-times"><span className={`status-pill ${label === "신청 가능" ? "open" : label === "마감" ? "closed" : "pending"}`}>{label}</span><span>시작 {formatKoreaTime(course.startsAt)}</span><span>마감 {formatKoreaTime(course.endsAt)}</span></div>
            <button className="button danger small" onClick={() => { if (window.confirm(`${course.name} 과목을 삭제할까요? 신청 명단은 보관함에 보관됩니다.`)) void run(async () => { await request("delete_course", { courseId: course.id }); await refresh(); }, "과목을 보관함으로 이동했습니다."); }}>과목 삭제</button>
          </article>;
        })}
        {!courses.length && <p className="empty-state">운영 중인 과목이 없습니다.</p>}
      </div>
    </section>}

    {tab === "roster" && <section className="admin-panel">
      <div className="section-heading"><div><h2>과목별 등록현황</h2><p className="muted">접수 순서대로 명단을 확인하고 엑셀로 내려받습니다.</p></div></div>
      <div className="inline-controls"><label>운영 과목<select value={courseRosterId} onChange={(event) => void loadRoster(event.target.value)}><option value="">과목 선택</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.category} · {course.name}</option>)}</select></label>
        <button className="button subtle" disabled={!courseRosterId || busy} onClick={() => void loadRoster(courseRosterId)}>새로고침</button>
        <button className="button primary" disabled={!courseRosterId || busy} onClick={() => void downloadCourseRoster()}>엑셀 다운로드</button>
      </div>
      {courseRosterId && <RosterTable rows={roster} />}
    </section>}

    {tab === "students" && <section className="admin-panel">
      <div className="roster-upload">
        <div><h2>학생 명단 엑셀 관리</h2><p className="muted">.xlsx · 최대 2MB · 최대 3,000명. 기존 신청 내역은 유지됩니다.</p></div>
        <div className="inline-controls">
          <button type="button" className="button subtle" onClick={downloadTemplate}>양식 다운로드</button>
          <label className="file-button">엑셀 업로드<input aria-label="학생 명단 엑셀 업로드" type="file" accept=".xlsx" onChange={(event) => void uploadRoster(event.target.files?.[0])} /></label>
        </div>
      </div>
      {rosterErrors.length > 0 && <div className="notice error" role="alert">
        <strong>엑셀 오류를 수정한 뒤 다시 업로드해주세요.</strong>
        <ul>{rosterErrors.map((item, index) => <li key={`${item.rowNumber}-${index}`}>{item.rowNumber ? `${item.rowNumber}행: ` : ""}{item.reason}</li>)}</ul>
      </div>}
      <div className="section-heading"><div><h2>학생별 신청 관리</h2><p className="muted">학번 5자리를 검색해 활성 신청 내역을 확인합니다.</p></div></div>
      <form className="inline-controls" onSubmit={loadStudent}><label>학번<input inputMode="numeric" pattern="[0-9]{5}" maxLength={5} required value={searchNumber} onChange={(event) => setSearchNumber(event.target.value)} /></label><button className="button primary" disabled={busy}>학생 검색</button></form>
      {searchedStudent && <><div className="student-summary"><strong>{searchedStudent.number} · {searchedStudent.name}</strong><span>현재 신청 {studentRegistrations.length}과목</span></div>
        {studentRegistrations.map((item) => <article className="result-row" key={item.id}><div><span className="eyebrow">{item.category}</span><strong>{item.courseName}</strong><small>신청 {formatKoreaTime(item.registeredAt)}</small></div>
          <button className="button danger small" onClick={() => { if (window.confirm(`${searchedStudent.name} 학생의 ${item.courseName} 신청을 삭제할까요?`)) void run(async () => {
            await request("delete_registration", { registrationId: item.id });
            const data = await request("search_student", { studentNumber: searchNumber });
            setSearchedStudent(data.student);
            setStudentRegistrations(data.registrations ?? []);
            await refresh();
          }, "신청을 취소 처리했습니다."); }}>신청 삭제</button></article>)}
        {!studentRegistrations.length && <p className="empty-state">현재 활성 신청이 없습니다.</p>}
      </>}
    </section>}

    {tab === "archive" && <section className="admin-panel">
      <div className="section-heading"><div><h2>삭제 과목 보관함</h2><p className="muted">보관 중인 과목의 신청 및 취소 기록을 조회할 수 있습니다.</p></div></div>
      <div className="inline-controls"><label>삭제 과목<select value={archiveId} onChange={(event) => void loadArchive(event.target.value)}><option value="">과목 선택</option>{archive.map((course) => <option key={course.id} value={course.id}>{course.category} · {course.name}</option>)}</select></label>
        <button className="button subtle" disabled={!archiveId || busy} onClick={() => void loadArchive(archiveId)}>신청 명단 조회</button>
        <button className="button subtle" disabled={!archiveId || busy} onClick={() => void downloadArchiveRoster()}>엑셀 다운로드</button>
        <button className="button danger" disabled={!archiveId || busy} onClick={() => {
          const selected = archive.find((course) => course.id === Number(archiveId));
          if (selected && window.confirm(`과목과 신청 명단을 복구할 수 없습니다.\n\n${selected.name} 과목과 연결된 기록을 영구 삭제할까요?`)) {
            void run(async () => { await request("purge_course", { courseId: selected.id, confirmation: "영구 삭제" }); setArchiveId(""); setArchiveRoster([]); await refresh(); }, "과목과 신청 기록을 영구 삭제했습니다.");
          }
        }}>과목 영구 삭제</button>
      </div>
      {archiveId && <RosterTable rows={archiveRoster} showStatus />}
      {!archive.length && <p className="empty-state">보관 중인 과목이 없습니다.</p>}
    </section>}

    {tab === "limits" && <section className="admin-panel">
      <div className="section-heading"><div><h2>신청 제한 설정</h2><p className="muted">기존 신청은 유지되고 이후 신청부터 한도가 적용됩니다.</p></div></div>
      <div className="limit-row"><label>학생당 전체 신청 한도<input type="number" min={1} max={20} value={totalLimitDraft} onChange={(event) => setTotalLimitDraft(event.target.value)} /></label>
        <button className="button primary" onClick={() => void run(async () => { await request("set_total_limit", { limit: Number(totalLimitDraft) }); await refresh(); }, "전체 신청 한도를 저장했습니다.")}>전체 한도 저장</button></div>
      <h3 className="subheading">범주별 신청 한도</h3>
      {categories.map((item) => <div className="limit-row" key={item.name}><label>{item.name}<input type="number" min={1} max={5} value={categoryLimitDraft[item.name] ?? String(item.limit)} onChange={(event) => setCategoryLimitDraft({ ...categoryLimitDraft, [item.name]: event.target.value })} /></label>
        <button className="button subtle" onClick={() => void run(async () => { await request("set_category_limit", { name: item.name, limit: Number(categoryLimitDraft[item.name] ?? item.limit) }); await refresh(); }, `${item.name} 신청 한도를 저장했습니다.`)}>한도 저장</button></div>)}
      <div className="limit-row"><label>새 범주<input maxLength={40} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="범주 이름" /></label><label>최대 과목 수<select value={newCategoryLimit} onChange={(event) => setNewCategoryLimit(event.target.value)}>{[1, 2, 3, 4, 5].map((limit) => <option key={limit}>{limit}</option>)}</select></label>
        <button className="button primary" onClick={() => void run(async () => { await request("set_category_limit", { name: newCategory, limit: Number(newCategoryLimit) }); setNewCategory(""); await refresh(); }, "범주별 신청 한도를 저장했습니다.")}>범주 추가</button></div>
    </section>}

    {tab === "account" && <section className="admin-panel">
      <div className="section-heading"><div><h2>계정 설정</h2><p className="muted">현재 관리자: {user.email}</p></div></div>
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { if (!supabase) throw new Error("Supabase 환경변수가 설정되지 않았습니다."); await supabase.auth.updateUser({ email: emailDraft }); setEmailDraft(""); }, "이메일 변경 확인 메일을 발송했습니다."); }}>
        <label>로그인 이메일 변경<input type="email" required value={emailDraft} onChange={(event) => setEmailDraft(event.target.value)} /></label><button className="button subtle">이메일 변경 요청</button>
      </form>
      <form className="account-form" onSubmit={(event) => { event.preventDefault(); void run(async () => {
        if (!supabase) throw new Error("Supabase 환경변수가 설정되지 않았습니다.");
        const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email ?? "", password: currentPassword });
        if (verifyError) throw new Error("현재 비밀번호가 일치하지 않습니다.");
        await supabase.auth.updateUser({ password: newPassword });
        setCurrentPassword(""); setNewPassword("");
      }, "비밀번호를 변경했습니다."); }}>
        <label>현재 비밀번호<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label>새 비밀번호<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <button className="button primary">비밀번호 변경</button>
      </form>
    </section>}

    {tab === "students" && <section className="danger-zone"><p className="eyebrow">DANGER ZONE</p><h2>학생 명단 및 신청 내역 초기화</h2><p>모든 학생 정보와 활성·취소 신청 내역이 삭제됩니다. 과목, 범주, 과목 코드 및 신청 한도는 유지됩니다.</p>
      <label>계속하려면 <strong>전체 삭제</strong>를 입력하세요.<input value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} placeholder="전체 삭제" /></label>
      <button className="button danger" disabled={busy || stats.studentCount === 0 || resetPhrase !== "전체 삭제"} onClick={() => {
        if (window.confirm("모든 학생 정보와 신청 내역을 되돌릴 수 없습니다. 전체 삭제를 실행할까요?")) {
          void run(async () => { await request("reset_students", { confirmation: resetPhrase }); setResetPhrase(""); setSearchedStudent(null); await refresh(); }, "학생 명단과 신청 내역을 초기화했습니다.");
        }
      }}>전체 학생 및 신청 내역 초기화</button>
    </section>}

    <footer className="footer admin-footer"><Link href="/">학생 페이지</Link><span>한국 표준시 · Asia/Seoul</span></footer>
  </main>;
}

function RosterTable({ rows, showStatus = false }: { rows: Registration[]; showStatus?: boolean }) {
  if (!rows.length) return <p className="empty-state">신청 내역이 없습니다.</p>;
  return <div className="table-scroll"><table><thead><tr><th>순번</th><th>학번</th><th>이름</th><th>등록 시간</th>{showStatus && <th>상태</th>}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.number}</td><td>{row.name}</td><td>{formatKoreaTime(row.registeredAt)}</td>{showStatus && <td>{(row as Registration & { status?: string }).status ?? "신청"}</td>}</tr>)}</tbody>
  </table></div>;
}
