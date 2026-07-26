import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import UltimatumStudentPage from './pages/UltimatumStudentPage.jsx';
import UltimatumInstructorPage from './pages/UltimatumInstructorPage.jsx';
import UltimatumSessionPage from './pages/UltimatumSessionPage.jsx';
import './styles.css';

// Standalone Ultimatum game (L19). The pages navigate using /ult/* paths, so those are
// kept verbatim; root aliases give the app a clean landing page and make the legacy
// "switch game" links (which pointed at /instructor) resolve to the ultimatum instructor.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Primary routes used by the ultimatum pages */}
        <Route path="/ult" element={<UltimatumStudentPage />} />
        <Route path="/ult/instructor" element={<UltimatumInstructorPage />} />
        <Route path="/ult/manage/:sessionCode" element={<UltimatumSessionPage />} />
        <Route path="/ult/session/:sessionCode/:studentId" element={<UltimatumStudentPage />} />
        <Route path="/ult/session/:sessionCode" element={<UltimatumStudentPage />} />

        {/* Root aliases */}
        <Route path="/" element={<UltimatumStudentPage />} />
        <Route path="/instructor" element={<UltimatumInstructorPage />} />
        <Route path="/manage/:sessionCode" element={<UltimatumSessionPage />} />
        <Route path="/session/:sessionCode/:studentId" element={<UltimatumStudentPage />} />
        <Route path="/session/:sessionCode" element={<UltimatumStudentPage />} />
      </Routes>
    </BrowserRouter>
  );
}
