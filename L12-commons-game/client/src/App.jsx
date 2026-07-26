import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { StudentPage } from './pages/StudentPage.jsx';
import { InstructorPage } from './pages/InstructorPage.jsx';
import { ResultsPage } from './pages/ResultsPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentPage />} />
        <Route path="/instructor" element={<InstructorPage />} />
        <Route path="/results" element={<ResultsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
