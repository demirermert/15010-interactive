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
    
    const code = sessionCodeInput.trim().toUpperCase();

    // A browser that already holds a seat in this game goes straight back to it (2026-11-08: a student who closed
    // the tab and typed the code again was told "the game has already started" and lost the seat). The seat's key
    // is student_<session code>_<personal code>; seats in other games are forgotten.
    let seat = null;
    try {
      Object.keys(localStorage).forEach(key => {
        if (!key.startsWith('student_')) return;
        const m = key.match(/^student_([A-Z0-9]+)_([A-Z0-9]+)$/);
        if (m && m[1] === code) seat = m[2];
        else localStorage.removeItem(key);
      });
    } catch { /* storage blocked: join as new */ }
    if (seat) {
      navigate(`/session/${code}/${seat}`);
      return;
    }

    // If name is not provided, generate a random name
    let fullName;
    if (!name.trim()) {
      fullName = generateRandomName();
    } else {
      fullName = name.trim();
    }
    
    // Redirect to session page (server will generate unique code)
    navigate(`/session/${code}`, {
      state: { studentName: fullName }
    });
  };

  // the join page in the 2026 lab look (2026-11-02)
  const renderStudentJoin = () => (
    <div className="lab">
      <header className="lab-head">
        <div className="hin">
          <img src="/course-logo.png" alt="15.010" />
          <div>
            <h1>Pricing Game</h1>
            <div className="sub">15.010 Class 13 &middot; price competition, round after round</div>
          </div>
          <img src="/sloan-logo.png" alt="MIT Sloan" style={{ marginLeft: 'auto' }} />
        </div>
      </header>
      <div className="join">
        <form className="card" onSubmit={handleJoinSession}>
          <div className="case">Join the game</div>
          <label htmlFor="student-name">Your name</label>
          <input id="student-name" type="text" autoComplete="name" value={name} onChange={event => setName(event.target.value)} />
          <label htmlFor="session-code">Session code (on the screen)</label>
          <input id="session-code" className="code" type="text" autoComplete="off" autoCapitalize="characters" maxLength={4}
            value={sessionCodeInput} onChange={event => setSessionCodeInput(event.target.value.toUpperCase())} required />
          <button type="submit" className="go">Join</button>
          {errorMessage && <div className="fb no">{errorMessage}</div>}
        </form>
      </div>
    </div>
  );

  return renderStudentJoin();
}

