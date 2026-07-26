import React, { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Helper function to format fish counts to 2 decimal places
function formatFish(value) {
  if (value === undefined || value === null) return '-';
  const num = Number(value);
  // If it's an integer, show no decimals. Otherwise show 2 decimals.
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}

export function InstructorDashboard({
  instructorName,
  session,
  joinInfo,
  canStart,
  startDisabledReason,
  onStart,
  leaderboard,
  errorMessage,
  onDismissError,
  countdown,
  roundTimer,
  roundActive,
  currentRoundNumber
}) {
  const [hoveredPond, setHoveredPond] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const players = session?.players || [];
  const students = players.filter(p => p.role === 'student');
  const ponds = session?.ponds || [];
  
  // Prepare chart data for student performance (flipped - horizontal bars)
  const studentPerformance = students
    .sort((a, b) => (b.totalFish || 0) - (a.totalFish || 0))
    .map(student => {
      const data = {
        name: student.name,
        'Total Fish': student.totalFish || 0
      };
      // Add round-by-round data
      if (student.history && student.history.length > 0) {
        student.history.forEach(round => {
          data[`Round ${round.round}`] = round.caught || 0;
        });
      }
      return data;
    });
  
  // Custom tooltip component to show round-by-round fish caught
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      return (
        <div style={{
          backgroundColor: 'white',
          border: '2px solid #10b981',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#1f2937' }}>
            {data.name}
          </p>
          <p style={{ margin: '0 0 8px 0', color: '#059669', fontWeight: 'bold' }}>
            Total: {formatFish(data['Total Fish'])} fish
          </p>
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '0.875rem', fontWeight: 'bold', color: '#6b7280' }}>
              By Round:
            </p>
            {Object.keys(data)
              .filter(key => key.startsWith('Round '))
              .sort((a, b) => {
                const roundA = parseInt(a.split(' ')[1]);
                const roundB = parseInt(b.split(' ')[1]);
                return roundA - roundB;
              })
              .map(roundKey => (
                <p key={roundKey} style={{ margin: '0', fontSize: '0.875rem', color: '#374151' }}>
                  {roundKey}: <strong>{formatFish(data[roundKey])}</strong> fish
                </p>
              ))
            }
          </div>
        </div>
      );
    }
    return null;
  };
  
  // Calculate average total fish per round over time
  const avgFishByRound = [];
  if (session?.roundResults && session.roundResults.length > 0) {
    // roundResults is an array of { round: number, results: [...] }
    session.roundResults.forEach(roundData => {
      const totalFishValues = roundData.results.map(r => r.totalFish || 0);
      const avg = totalFishValues.reduce((sum, val) => sum + val, 0) / totalFishValues.length;
      avgFishByRound.push({
        round: `Round ${roundData.round}`,
        'Average Total Fish': parseFloat(avg.toFixed(2))
      });
    });
  }
  
  return (
    <div className="card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2>Instructor: {instructorName}</h2>
          <p>Session code: <strong>{session?.code || joinInfo?.code || 'Loading...'}</strong></p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
            <span className="status-tag">{session?.status?.toUpperCase() || 'LOBBY'}</span>
            {(session?.status === 'running' || session?.status === 'active') && (
              <div style={{ 
                padding: '0.5rem 1rem',
                backgroundColor: '#f0fdf4',
                color: '#15803d',
                border: '2px solid #22c55e',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '1.1rem'
              }}>
                📊 Round {currentRoundNumber || session?.currentRound || 0} of {session?.config?.rounds || 0}
              </div>
            )}
            {roundActive && roundTimer !== null && (
              <div style={{ 
                padding: '0.5rem 1rem',
                backgroundColor: '#dbeafe',
                color: '#1e40af',
                border: '2px solid #3b82f6',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '1.1rem'
              }}>
                ⏱️ Round Timer: {roundTimer}s
              </div>
            )}
            {countdown && countdown.timeRemaining > 0 && !roundActive && (
              <div style={{ 
                padding: '0.5rem 1rem',
                backgroundColor: '#fef3c7',
                color: '#f59e0b',
                border: '2px solid #f59e0b',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '1.1rem'
              }}>
                ⏱️ Next Round in: {countdown.timeRemaining}s
              </div>
            )}
          </div>
        </div>
        {canStart ? (
          <button className="primary" onClick={onStart}>
            Start game
          </button>
        ) : (
          startDisabledReason ? (
            <span style={{ color: '#dc2626', fontWeight: 500 }}>{startDisabledReason}</span>
          ) : null
        )}
      </header>

      {errorMessage && (
        <div
          style={{
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{errorMessage}</span>
          {onDismissError && (
            <button
              onClick={onDismissError}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#991b1b',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Dismiss
            </button>
          )}
        </div>
      )}

      {/* Ponds Visualization - 3 columns, multiple rows */}
      {ponds.length > 0 && (
        <section style={{ marginBottom: '1.5rem' }}>
          <h3>🐟 Fish Ponds</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {ponds.map(pond => {
              const pondPlayerObjects = pond.players.map(playerId => 
                players.find(p => p.socketId === playerId)
              ).filter(p => p);
              const pondPlayers = pondPlayerObjects.map(p => p.name);
              
              const initialFish = session?.config?.initialFish || 16;
              const fishHealth = Math.min(100, Math.max(0, (pond.remainingFish / initialFish) * 100));
              const fishCount = pond.remainingFish;
              
              // Choose color based on fish health
              const bgColor = fishHealth > 66 ? '#d1fae5' : fishHealth > 33 ? '#fed7aa' : '#fecaca';
              const borderColor = fishHealth > 66 ? '#10b981' : fishHealth > 33 ? '#f59e0b' : '#ef4444';
              const textColor = fishHealth > 66 ? '#065f46' : fishHealth > 33 ? '#9a3412' : '#991b1b';
              
              // Build catch matrix for tooltip - format as a clean table
              const catchMatrix = [];
              const playerNames = pondPlayerObjects.map(p => p.name);
              
              for (let round = 1; round <= (session?.currentRound || 0); round++) {
                const roundData = {};
                pondPlayerObjects.forEach(player => {
                  const roundHistory = player.history?.find(h => h.round === round);
                  roundData[player.name] = roundHistory?.caught || 0;
                });
                catchMatrix.push({ round, data: roundData });
              }
              
              // Format tooltip as a clean table with better spacing
              let tooltipText = '🐟 FISH CAUGHT PER ROUND 🐟\n\n';
              if (catchMatrix.length > 0) {
                // Calculate column width based on longest name
                const maxNameLength = Math.max(...playerNames.map(n => n.length), 8);
                const colWidth = Math.max(maxNameLength + 2, 12);
                
                // Header row with player names (shortened if needed)
                tooltipText += 'Round'.padEnd(8) + '│ ';
                playerNames.forEach(name => {
                  const displayName = name.length > colWidth - 2 ? name.substring(0, colWidth - 2) : name;
                  tooltipText += displayName.padEnd(colWidth) + '│ ';
                });
                tooltipText += '\n';
                tooltipText += '═'.repeat(8 + playerNames.length * (colWidth + 2) + 2) + '\n';
                
                // Data rows with better formatting
                catchMatrix.forEach(({ round, data }) => {
                  tooltipText += `  ${round}     │ `;
                  playerNames.forEach(name => {
                    const caught = data[name] || 0;
                    const fishEmoji = caught > 0 ? '🐠'.repeat(Math.min(caught, 3)) : '－';
                    const display = `${caught} ${fishEmoji}`;
                    tooltipText += display.padEnd(colWidth) + '│ ';
                  });
                  tooltipText += '\n';
                });
                
                // Total row
                tooltipText += '─'.repeat(8 + playerNames.length * (colWidth + 2) + 2) + '\n';
                tooltipText += 'TOTAL  │ ';
                playerNames.forEach(name => {
                  const total = catchMatrix.reduce((sum, { data }) => sum + (data[name] || 0), 0);
                  tooltipText += String(total).padEnd(colWidth) + '│ ';
                });
              } else {
                tooltipText = '🐟 No rounds completed yet';
              }
              
              return (
                <div 
                  key={pond.id} 
                  style={{ 
                    padding: '0.75rem', 
                    backgroundColor: bgColor,
                    borderRadius: '10px',
                    border: `2px solid ${borderColor}`,
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.3s ease',
                    position: 'relative',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => {
                    setHoveredPond({ pondId: pond.id, catchMatrix, playerNames });
                    setTooltipPosition({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseMove={(e) => {
                    setTooltipPosition({ x: e.clientX, y: e.clientY });
                  }}
                  onMouseLeave={() => {
                    setHoveredPond(null);
                  }}
                >
                  {/* Pond name with hover info */}
                  <h4 style={{ marginTop: 0, color: textColor, fontSize: '0.875rem', marginBottom: '0.5rem', cursor: 'help' }}>
                    {pond.id}
                  </h4>
                  
                  {/* Horizontal layout: Fish count on left, Players on right - Equal width */}
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
                    {/* Left side: Fish count and health bar - Equal width */}
                    <div style={{ 
                      flex: '1',
                      textAlign: 'center', 
                      padding: '0.5rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.7)',
                      borderRadius: '6px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center'
                    }}>
                      <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: textColor, lineHeight: 1 }}>
                        {fishCount}
                      </div>
                      <div style={{ fontSize: '0.65rem', color: textColor, marginTop: '0.25rem', marginBottom: '0.5rem' }}>
                        fish left
                      </div>
                      {/* Compact health bar */}
                      <div style={{ 
                        width: '100%', 
                        height: '8px', 
                        backgroundColor: 'rgba(255, 255, 255, 0.5)', 
                        borderRadius: '4px', 
                        overflow: 'hidden',
                        border: '1px solid rgba(0, 0, 0, 0.1)'
                      }}>
                        <div 
                          style={{ 
                            width: `${fishHealth}%`, 
                            height: '100%', 
                            backgroundColor: borderColor,
                            transition: 'width 0.5s ease'
                          }}
                        />
                      </div>
                    </div>
                    
                    {/* Right side: Players list as column - Equal width */}
                    <div style={{ 
                      flex: '1',
                      padding: '0.5rem',
                      backgroundColor: 'rgba(255, 255, 255, 0.5)',
                      borderRadius: '6px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center'
                    }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: textColor, marginBottom: '0.25rem' }}>
                        👥 Players ({pondPlayers.length})
                      </div>
                      <div style={{ fontSize: '0.7rem', color: textColor, lineHeight: 1.4 }}>
                        {pondPlayers.map((name, idx) => (
                          <div key={idx}>• {name}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Two-column layout: Players on left, Leaderboard on right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Players Section - Left Column with scrollable table */}
        <section>
          <h3>Players ({students.length})</h3>
          <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <table className="table" style={{ marginTop: 0 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Pond</th>
                </tr>
              </thead>
              <tbody>
                {students.map(player => (
                  <tr key={player.socketId}>
                    <td>{player.name}</td>
                    <td>
                      <span style={{ 
                        color: player.connected ? '#10b981' : '#ef4444',
                        fontWeight: 500 
                      }}>
                        {player.connected ? '● Connected' : '○ Disconnected'}
                      </span>
                    </td>
                    <td><strong>{player.pondId || '-'}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Leaderboard Section - Right Column - Top 10 only */}
        {leaderboard && leaderboard.length > 0 && (
          <section>
            <h3>🏆 Leaderboard (Top 10)</h3>
            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <table className="table" style={{ marginTop: 0 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Total Fish</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.slice(0, 10).map((entry, index) => (
                    <tr key={entry.socketId} style={{ 
                      backgroundColor: index === 0 ? '#fef3c7' : index === 1 ? '#e5e7eb' : index === 2 ? '#fed7aa' : 'transparent'
                    }}>
                      <td>
                        <strong>
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                        </strong>
                      </td>
                      <td><strong>{entry.name}</strong></td>
                      <td><strong>{formatFish(entry.totalFish)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Student Performance Chart - Horizontal Bar Chart */}
      {studentPerformance.length > 0 && session?.status !== 'lobby' && (
        <section style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>📊 Student Performance</h3>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: '800px' }}>
              <ResponsiveContainer width="100%" height={Math.max(200, studentPerformance.length * 40)}>
                <BarChart data={studentPerformance} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    width={180} 
                    tick={{ fontSize: 12 }}
                    interval={0}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="Total Fish" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Average Total Fish Over Time - Line Chart */}
      {avgFishByRound.length > 0 && (
        <section style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0 }}>📈 Average Total Fish Over Time</h3>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: '100%', maxWidth: '800px' }}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={avgFishByRound} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="round" />
                  <YAxis label={{ value: 'Average Total Fish', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }} />
                  <Tooltip />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="Average Total Fish" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ fill: '#3b82f6', r: 5 }}
                    activeDot={{ r: 7 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Pond Winners - Show at end of game */}
      {session?.status === 'complete' && ponds.length > 0 && (
        <section style={{ marginTop: '1.5rem', padding: '1.5rem', backgroundColor: '#fef3c7', borderRadius: '12px', border: '3px solid #f59e0b' }}>
          <h3 style={{ marginTop: 0, textAlign: 'center', color: '#92400e', fontSize: '1.5rem' }}>
            🏆 Pond Winners (Copy & Paste) 🏆
          </h3>
          <p style={{ textAlign: 'center', color: '#78350f', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Click names to copy
          </p>
          
          {/* Simple list format for easy copying */}
          <div style={{ 
            backgroundColor: 'white', 
            padding: '1.5rem', 
            borderRadius: '8px',
            border: '2px solid #f59e0b',
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            {ponds.map((pond, index) => {
              // Get all players in this pond
              const pondPlayerObjects = pond.players
                .map(playerId => players.find(p => p.socketId === playerId))
                .filter(p => p && p.role === 'student');
              
              // Find the winner (highest totalFish)
              const winner = pondPlayerObjects.reduce((top, player) => {
                return (!top || player.totalFish > top.totalFish) ? player : top;
              }, null);
              
              if (!winner) return null;
              
              return (
                <div
                  key={pond.id}
                  style={{
                    padding: '0.75rem',
                    marginBottom: index < ponds.length - 1 ? '0.5rem' : 0,
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderLeft: '4px solid #f59e0b'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>🥇</span>
                    <div>
                      <div style={{ fontSize: '0.875rem', color: '#6b7280', fontWeight: 500 }}>
                        {pond.id}
                      </div>
                      <div 
                        style={{ 
                          fontSize: '1.1rem', 
                          fontWeight: 'bold', 
                          color: '#1f2937',
                          userSelect: 'all',
                          cursor: 'text'
                        }}
                        title="Click to select and copy"
                      >
                        {winner.name}
                      </div>
                    </div>
                  </div>
                  <div style={{ 
                    fontSize: '1rem', 
                    fontWeight: 'bold', 
                    color: '#059669',
                    textAlign: 'right'
                  }}>
                    {formatFish(winner.totalFish)} fish
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 'normal' }}>
                      of {pondPlayerObjects.length} players
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Copy all names button */}
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              onClick={() => {
                const winners = ponds.map(pond => {
                  const pondPlayerObjects = pond.players
                    .map(playerId => players.find(p => p.socketId === playerId))
                    .filter(p => p && p.role === 'student');
                  const winner = pondPlayerObjects.reduce((top, player) => {
                    return (!top || player.totalFish > top.totalFish) ? player : top;
                  }, null);
                  return winner?.name;
                }).filter(Boolean).join('\n');
                
                navigator.clipboard.writeText(winners).then(() => {
                  alert('✅ Winner names copied to clipboard!');
                }).catch(() => {
                  alert('⚠️ Could not copy. Please select and copy manually.');
                });
              }}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              📋 Copy All Winner Names
            </button>
          </div>
        </section>
      )}

      {/* Custom Pond Tooltip */}
      {hoveredPond && (
        <div style={{
          position: 'fixed',
          left: tooltipPosition.x + 10,
          top: tooltipPosition.y + 10,
          backgroundColor: 'white',
          border: '2px solid #10b981',
          borderRadius: '8px',
          padding: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 9999,
          pointerEvents: 'none',
          maxWidth: '500px'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', color: '#1f2937', fontSize: '1rem', textAlign: 'center' }}>
            🐟 {hoveredPond.pondId} - Fish Caught Per Round
          </p>
          {hoveredPond.catchMatrix.length > 0 ? (
            <div>
              <table style={{ 
                width: '100%', 
                borderCollapse: 'collapse',
                fontSize: '0.875rem'
              }}>
                <thead>
                  <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #10b981' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 'bold', color: '#374151' }}>Round</th>
                    {hoveredPond.playerNames.map(name => (
                      <th key={name} style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', color: '#374151' }}>
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hoveredPond.catchMatrix.map(({ round, data }) => (
                    <tr key={round} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 'bold', color: '#374151' }}>Round {round}</td>
                      {hoveredPond.playerNames.map(name => {
                        const caught = data[name] || 0;
                        return (
                          <td key={name} style={{ padding: '6px 8px', textAlign: 'center', color: '#059669', fontWeight: 'bold' }}>
                            {formatFish(caught)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: '#f3f4f6', borderTop: '2px solid #10b981' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 'bold', color: '#1f2937' }}>TOTAL</td>
                    {hoveredPond.playerNames.map(name => {
                      const total = hoveredPond.catchMatrix.reduce((sum, { data }) => sum + (data[name] || 0), 0);
                      return (
                        <td key={name} style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 'bold', color: '#059669' }}>
                          {formatFish(total)}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: '8px 0 0 0', color: '#6b7280', textAlign: 'center' }}>
              No rounds completed yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
