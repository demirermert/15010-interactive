import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';


// Random name generation
const firstNames = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Parker',
  'Quinn', 'Reese', 'Cameron', 'Dakota', 'Skylar', 'Hayden', 'Rowan', 'Sage'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore'
];

function generateRandomName() {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const randomNum = Math.floor(Math.random() * 1000);
  return `${firstName} ${lastName} ${randomNum}`;
}

export default function StudentPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [sessionCodeInput, setSessionCodeInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleJoinSession = event => {
    event.preventDefault();
    setErrorMessage('');
    if (!sessionCodeInput.trim()) {
      setErrorMessage('Enter a session code');
      return;
    }
    
    // Solution #2: Clear ALL old student session data when manually joining
    // This ensures no stale data from previous sessions
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('student_')) {
        localStorage.removeItem(key);
      }
    });
    console.log('Cleared all previous student session data');
    
    // If name is not provided, generate a random name
    let fullName;
    if (!name.trim()) {
      fullName = generateRandomName();
    } else {
      fullName = name.trim();
    }
    
    // Redirect to session page (server will generate unique code)
    navigate(`/session/${sessionCodeInput.toUpperCase()}`, {
      state: { studentName: fullName }
    });
  };

  const renderStudentJoin = () => (
    <div className="card student-join-card">
      {/* Logos Container - Responsive */}
      <div className="logos-container">
        <img 
          src="/course-logo.png" 
          alt="Course Logo"
          className="logo-left"
        />
        <img 
          src="/sloan-logo.png" 
          alt="MIT Sloan School of Management"
          className="logo-right"
        />
      </div>

      {/* Header */}
      <div className="student-header">
        <h1>Welcome to 15.010</h1>
        <p>Economic Analysis of Business Decisions</p>
      </div>

      <form onSubmit={handleJoinSession} className="student-form">
        <div className="input-row">
          <label htmlFor="student-name">Name</label>
          <input
            id="student-name"
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
          />
        </div>
        <div className="input-row">
          <label htmlFor="session-code">Session code</label>
          <input
            id="session-code"
            type="text"
            value={sessionCodeInput}
            onChange={event => setSessionCodeInput(event.target.value.toUpperCase())}
            required
          />
        </div>
        <button type="submit" className="primary">
          Join session
        </button>
      </form>
      {errorMessage && <p style={{ color: '#dc2626', marginTop: '1rem' }}>{errorMessage}</p>}
    </div>
  );

  return (
    <div className="app-shell">
      {renderStudentJoin()}
    </div>
  );
}

