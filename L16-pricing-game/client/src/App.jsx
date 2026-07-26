import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import InstructorPage from './pages/InstructorPage.jsx';
import StudentPage from './pages/StudentPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import SessionPage from './pages/SessionPage.jsx';
import UltimatumStudentPage from './pages/UltimatumStudentPage.jsx';
import UltimatumInstructorPage from './pages/UltimatumInstructorPage.jsx';
import UltimatumSessionPage from './pages/UltimatumSessionPage.jsx';
import './styles.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentPage />} />
        <Route path="/instructor" element={<InstructorPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/session/:sessionCode" element={<SessionPage />} />
        <Route path="/session/:sessionCode/:studentId" element={<SessionPage />} />
        <Route path="/manage/:sessionCode" element={<SessionPage />} />
        
        {/* Ultimatum Game Routes */}
        <Route path="/ult" element={<UltimatumStudentPage />} />
        <Route path="/ult/instructor" element={<UltimatumInstructorPage />} />
        <Route path="/ult/manage/:sessionCode" element={<UltimatumSessionPage />} />
        <Route path="/ult/session/:sessionCode/:studentId" element={<UltimatumStudentPage />} />
        <Route path="/ult/session/:sessionCode" element={<UltimatumStudentPage />} />
      </Routes>
    </BrowserRouter>
  );
}
