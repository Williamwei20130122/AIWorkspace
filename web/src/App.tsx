import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/components/auth/AuthProvider";
import { roleHome } from "@/lib/format";
import LoginPage from "@/pages/Login";
import RegisterPage from "@/pages/Register";
import TeacherDashboard from "@/pages/teacher/Dashboard";
import TeacherClasses from "@/pages/teacher/Classes";
import TeacherClassDetail from "@/pages/teacher/ClassDetail";
import TeacherTopics from "@/pages/teacher/Topics";
import TeacherTopicDetail from "@/pages/teacher/TopicDetail";
import TeacherStudents from "@/pages/teacher/Students";
import TeacherEvaluations from "@/pages/teacher/Evaluations";
import StudentDashboard from "@/pages/student/Dashboard";
import StudentClasses from "@/pages/student/Classes";
import StudentTopics from "@/pages/student/Topics";
import StudentTopicDetail from "@/pages/student/TopicDetail";
import StudentEvaluations from "@/pages/student/Evaluations";

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p className="text-sm text-ink-soft">加载中…</p>
      </div>
    );
  }
  return <Navigate to={user ? roleHome(user.role) : "/login"} replace />;
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-brand-600">404</p>
        <h1 className="mt-2 text-xl font-semibold text-brand-900">页面不存在</h1>
        <a href="/" className="aw-btn aw-btn-primary mt-4">
          返回首页
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/teacher"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/topics"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherTopics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/topics/:id"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherTopicDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/classes"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherClasses />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/classes/:id"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherClassDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/students"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherStudents />
          </ProtectedRoute>
        }
      />
      <Route
        path="/teacher/evaluations"
        element={
          <ProtectedRoute role="TEACHER">
            <TeacherEvaluations />
          </ProtectedRoute>
        }
      />

      <Route
        path="/student"
        element={
          <ProtectedRoute role="STUDENT">
            <StudentDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/classes"
        element={
          <ProtectedRoute role="STUDENT">
            <StudentClasses />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/topics"
        element={
          <ProtectedRoute role="STUDENT">
            <StudentTopics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/topics/:id"
        element={
          <ProtectedRoute role="STUDENT">
            <StudentTopicDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/student/evaluations"
        element={
          <ProtectedRoute role="STUDENT">
            <StudentEvaluations />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
