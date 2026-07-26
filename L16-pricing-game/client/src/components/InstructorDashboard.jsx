import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

export function InstructorDashboard({
  instructorName,
  session,
  canStart,
  canOpenLobby,
  startDisabledReason,
  onStart,
  onOpenLobby,
  onEndSession,
  leaderboard,
  latestRound,
  allRounds,
  errorMessage,
  onDismissError,
  timer,
  roundActive,
  nextRoundCountdown
}) {
  const navigate = useNavigate();
  const [showEndConfirm, setShowEndConfirm] = React.useState(false);
  const [hoveredPoint, setHoveredPoint] = React.useState(null);
  const [hoveredPlayerPoint, setHoveredPlayerPoint] = React.useState(null);
  const [hoveredPair, setHoveredPair] = React.useState(null);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [studentSearchQuery, setStudentSearchQuery] = React.useState('');
  const [pairSearchQuery, setPairSearchQuery] = React.useState('');
  
  // Filter out instructors from player list - show students and AI players
  const players = (session?.players || []).filter(player => player.role === 'student' || player.role === 'ai');
  
  // Filter students based on search query
  const filteredPlayers = players.filter(player =>
    player.name.toLowerCase().includes(studentSearchQuery.toLowerCase()) ||
    (player.pairId && player.pairId.toLowerCase().includes(studentSearchQuery.toLowerCase()))
  );
  
  // Filter leaderboard based on search query
  const filteredLeaderboard = leaderboard && leaderboard.length > 0
    ? leaderboard.filter(player => 
        player.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];
  
  const handleDownloadData = () => {
    if (!session?.code) return;
    const url = buildApiUrl(`/session/${session.code}/export`);
    window.open(url, '_blank');
  };
  
  const handleEndSessionClick = () => {
    setShowEndConfirm(true);
  };
  
  const handleConfirmEnd = () => {
    setShowEndConfirm(false);
    onEndSession();
  };
  
  const handleBackToSessions = () => {
    // Navigate back to instructor page
    navigate('/instructor');
  };

  // Calculate average price and SD per round from all rounds data
  const calculateRoundStats = () => {
    if (!allRounds || allRounds.length === 0) return [];
    
    // Calculate avg and SD for each round
    return allRounds.map(roundSummary => {
      const prices = [];
      roundSummary.results.forEach(result => {
        // Handle both live game format (result.playerA/playerB) and database format (flat result)
        if (result.playerA && result.playerB) {
          prices.push(result.playerA.price);
          prices.push(result.playerB.price);
        } else if (result.price !== undefined) {
          // Database format - just has price directly
          prices.push(result.price);
        }
      });
      
      if (prices.length === 0) return { round: roundSummary.round, avg: 0, sd: 0 };
      
      const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
      const sd = Math.sqrt(variance);
      
      return { round: roundSummary.round, avg, sd };
    });
  };

  // Calculate total profit by pair across all rounds
  const calculatePairProfits = () => {
    if (!allRounds || allRounds.length === 0) return [];
    
    const pairProfits = new Map();
    const processedPairs = new Set(); // Track which pairs we've processed per round
    
    allRounds.forEach(roundSummary => {
      processedPairs.clear(); // Reset for each round
      
      roundSummary.results.forEach(result => {
        // Handle both live game format (result.playerA/playerB) and database format (flat result)
        if (result.playerA && result.playerB) {
          // Live game format - use actual pairId
          const pairId = result.pairId;
          const totalPairProfit = result.playerA.profit + result.playerB.profit;
          
          if (!pairProfits.has(pairId)) {
            pairProfits.set(pairId, {
              pairId,
              playerA: result.playerA.name,
              playerB: result.playerB.name,
              totalProfit: 0,
              priceHistoryA: [],
              priceHistoryB: [],
              profitHistoryA: [],
              profitHistoryB: [],
              shareHistoryA: [],
              shareHistoryB: []
            });
          }
          
          const pairData = pairProfits.get(pairId);
          pairData.totalProfit += totalPairProfit;
          pairData.priceHistoryA.push(result.playerA.price);
          pairData.priceHistoryB.push(result.playerB.price);
          pairData.profitHistoryA.push(result.playerA.profit);
          pairData.profitHistoryB.push(result.playerB.profit);
          pairData.shareHistoryA.push(result.playerA.share);
          pairData.shareHistoryB.push(result.playerB.share);
        } else if (result.playerName && result.opponentName) {
          // Database format - need to get pairId from session.players
          // Find the player in the current session to get their pairId
          let pairId = null;
          if (session && session.players) {
            const player = session.players.find(p => p.name === result.playerName);
            if (player && player.pairId) {
              pairId = player.pairId;
            }
          }
          
          // Fallback: create a consistent pair key if no pairId found
          if (!pairId) {
            pairId = [result.playerName, result.opponentName].sort().join('|');
          }
          
          // Only process each pair once per round (since database has both perspectives)
          if (processedPairs.has(pairId)) {
            return; // Skip, we already processed this pair in this round
          }
          processedPairs.add(pairId);
          
          if (!pairProfits.has(pairId)) {
            pairProfits.set(pairId, {
              pairId,
              playerA: result.playerName,
              playerB: result.opponentName,
              totalProfit: 0,
              priceHistoryA: [],
              priceHistoryB: [],
              profitHistoryA: [],
              profitHistoryB: [],
              shareHistoryA: [],
              shareHistoryB: []
            });
          }
          
          // Add both players' profits and prices for this round
          const opponentResult = roundSummary.results.find(r => 
            r.playerName === result.opponentName && r.opponentName === result.playerName
          );
          
          const totalPairProfitThisRound = result.profit + (opponentResult ? opponentResult.profit : 0);
          const pairData = pairProfits.get(pairId);
          pairData.totalProfit += totalPairProfitThisRound;
          pairData.priceHistoryA.push(result.price);
          pairData.priceHistoryB.push(result.opponentPrice);
          pairData.profitHistoryA.push(result.profit);
          pairData.profitHistoryB.push(opponentResult ? opponentResult.profit : 0);
          // Database format uses 'marketShare' instead of 'share'
          pairData.shareHistoryA.push(result.marketShare ?? result.share ?? 0);
          pairData.shareHistoryB.push(opponentResult ? (opponentResult.marketShare ?? opponentResult.share ?? 0) : 0);
        }
      });
    });
    
    return Array.from(pairProfits.values()).sort((a, b) => b.totalProfit - a.totalProfit);
  };

  // Calculate individual player profits by pair
  const calculateIndividualProfits = () => {
    if (!allRounds || allRounds.length === 0) return [];
    
    const playerProfits = new Map();
    
    allRounds.forEach(roundSummary => {
      roundSummary.results.forEach(result => {
        if (result.playerA && result.playerB) {
          // Live game format
          if (!playerProfits.has(result.playerA.name)) {
            playerProfits.set(result.playerA.name, { name: result.playerA.name, profit: 0 });
          }
          if (!playerProfits.has(result.playerB.name)) {
            playerProfits.set(result.playerB.name, { name: result.playerB.name, profit: 0 });
          }
          playerProfits.get(result.playerA.name).profit += result.playerA.profit;
          playerProfits.get(result.playerB.name).profit += result.playerB.profit;
        } else if (result.playerName) {
          // Database format
          if (!playerProfits.has(result.playerName)) {
            playerProfits.set(result.playerName, { name: result.playerName, profit: 0 });
          }
          playerProfits.get(result.playerName).profit += result.profit;
        }
      });
    });
    
    // Group by pairs based on pairProfits
    const individualByPair = [];
    pairProfits.forEach((pair, index) => {
      const playerAProfit = playerProfits.get(pair.playerA);
      const playerBProfit = playerProfits.get(pair.playerB);
      
      if (playerAProfit && playerBProfit) {
        individualByPair.push({
          pairId: pair.pairId,
          pairIndex: pair.pairId.toString().replace('pair-', ''),
          playerA: pair.playerA,
          playerB: pair.playerB,
          profitA: playerAProfit.profit,
          profitB: playerBProfit.profit
        });
      }
    });
    
    return individualByPair;
  };

  const roundStats = calculateRoundStats();
  const pairProfits = calculatePairProfits();
  const individualProfits = calculateIndividualProfits();
  
  // Filter pair profits based on search query
  const filteredPairProfits = pairProfits.filter(pair =>
    pair.playerA.toLowerCase().includes(pairSearchQuery.toLowerCase()) ||
    pair.playerB.toLowerCase().includes(pairSearchQuery.toLowerCase()) ||
    pair.pairId.toLowerCase().includes(pairSearchQuery.toLowerCase())
  );
  
  return (
    <div className="card">
      {/* Header */}
      <header style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '2px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: '0 0 0.5rem 0' }}>Instructor: {instructorName}</h2>
            <p style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>
              Session: <strong>{session?.sessionName || session?.code}</strong> ({session?.code})
            </p>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span className="status-tag">{session?.status?.toUpperCase()}</span>
            </div>
            {/* Parameters display */}
            {session?.config && (
              <div style={{
                fontSize: '0.75rem',
                color: '#6b7280',
                marginTop: '0.5rem'
              }}>
                {session.config.modelType === 'hotelling' ? (
                  <>
                    Hotelling Model | t=${session.config.travelCost} | V=${session.config.consumerValue} | x₁={session.config.x1} | x₂={session.config.x2}
                  </>
                ) : (
                  <>
                    Logit Model | α={session.config.alpha} | σ={session.config.sigma} | Market Size: {session.config.marketSize}
                  </>
                )}
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
            <button 
              onClick={handleBackToSessions}
              style={{ 
                padding: '0.5rem 1rem',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 500,
                whiteSpace: 'nowrap'
              }}
            >
              ← Back to Sessions
            </button>
            {session?.status === 'running' || session?.status === 'complete' ? (
              <button onClick={handleDownloadData} style={{ padding: '0.5rem 1rem', whiteSpace: 'nowrap' }}>
                📥 Download CSV
              </button>
            ) : null}
            {session?.status !== 'complete' && (
              <button 
                onClick={handleEndSessionClick}
                style={{ 
                  padding: '0.5rem 1rem',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 500,
                  whiteSpace: 'nowrap'
                }}
              >
                End Session
              </button>
            )}
            {canOpenLobby ? (
              <button className="primary" onClick={onOpenLobby} style={{ whiteSpace: 'nowrap', backgroundColor: '#10b981' }}>
                🚪 Open Lobby
              </button>
            ) : canStart ? (
              <button className="primary" onClick={onStart} style={{ whiteSpace: 'nowrap' }}>
                🎮 Start Game
              </button>
            ) : (
              startDisabledReason ? (
                <span style={{ color: '#dc2626', fontWeight: 500, fontSize: '0.875rem' }}>
                  {startDisabledReason}
                </span>
              ) : null
            )}
          </div>
        </div>
        
        {/* Centralized Round and Timer Display */}
        <div style={{ 
          textAlign: 'center', 
          padding: '1.5rem',
          backgroundColor: nextRoundCountdown > 0 ? '#fef3c7' : '#f9fafb',
          borderRadius: '8px',
          marginTop: '1rem',
          border: nextRoundCountdown > 0 ? '3px solid #f59e0b' : 'none',
          boxShadow: nextRoundCountdown > 0 ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none',
          transition: 'all 0.3s ease'
        }}>
          <div style={{ 
            fontSize: '1.5rem', 
            fontWeight: 600,
            color: nextRoundCountdown > 0 ? '#92400e' : '#374151',
            marginBottom: (roundActive || nextRoundCountdown > 0) ? '0.75rem' : 0,
            textTransform: nextRoundCountdown > 0 ? 'uppercase' : 'none'
          }}>
            {nextRoundCountdown > 0 ? 'Next Round Starting In' : `Round ${session?.currentRound || 0} of ${session?.config?.rounds || 0}`}
          </div>
          {roundActive && (
            <div style={{
              fontSize: '2.5rem',
              fontWeight: 700,
              color: timer <= 10 ? '#dc2626' : '#3b82f6',
              transition: 'color 0.3s ease'
            }}>
              {timer}s
            </div>
          )}
          {nextRoundCountdown !== null && nextRoundCountdown > 0 && (
            <div style={{
              fontSize: '4rem',
              fontWeight: 700,
              color: '#f59e0b',
              lineHeight: 1
            }}>
              {nextRoundCountdown}s
            </div>
          )}
        </div>

        {errorMessage && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginTop: '1rem',
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
      </header>

      {/* Main Dashboard Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Left Column - Students List */}
        <div>
          <h3 style={{ margin: '0 0 1rem 0' }}>Students ({players.length})</h3>
          
          {/* Search Box */}
          <div style={{ marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="🔍 Search students..."
              value={studentSearchQuery}
              onChange={(e) => setStudentSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
            />
          </div>
          
          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#f9fafb'
          }}>
            {filteredPlayers.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', margin: 0 }}>
                {studentSearchQuery 
                  ? `No students found matching "${studentSearchQuery}"`
                  : 'No students have joined yet.'}
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f3f4f6', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '2px solid #d1d5db' }}>#</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '2px solid #d1d5db' }}>Name</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center', borderBottom: '2px solid #d1d5db' }}>Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center', borderBottom: '2px solid #d1d5db' }}>Pair</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((player, index) => (
                    <tr key={player.socketId} style={{ backgroundColor: index % 2 === 0 ? 'white' : '#f9fafb' }}>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>{index + 1}</td>
                      <td style={{ padding: '0.75rem', fontWeight: 500, borderBottom: '1px solid #e5e7eb' }}>
                        {player.name}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: 
                          player.connectionStatus === 'online' ? '#d1fae5' : 
                          player.connectionStatus === 'away' ? '#fef3c7' : 
                          '#fee2e2',
                        color: 
                          player.connectionStatus === 'online' ? '#065f46' : 
                          player.connectionStatus === 'away' ? '#92400e' : 
                          '#991b1b'
                      }}>
                        {player.connectionStatus === 'online' ? '🟢 Online' : 
                         player.connectionStatus === 'away' ? '🟡 Away' : 
                         '🔴 Offline'}
                      </span>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', borderBottom: '1px solid #e5e7eb' }}>
                        {player.pairId || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Column - Leaderboard */}
        <div>
          <h3 style={{ margin: '0 0 1rem 0' }}>🏆 Leaderboard</h3>
          
          {/* Search Box */}
          <div style={{ marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="🔍 Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
            />
          </div>
          
          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: '#f9fafb'
          }}>
            {filteredLeaderboard.length > 0 ? (
              <div>
                {filteredLeaderboard.map((player, index) => {
                  // Find the original rank in the full leaderboard by comparing names
                  const originalRank = leaderboard.findIndex(p => p.name === player.name) + 1;
                  const isTopThree = originalRank <= 3;
                  
                  return (
                    <div
                      key={player.socketId}
                      style={{
                        padding: '0.75rem 1rem',
                        borderBottom: index < filteredLeaderboard.length - 1 ? '1px solid #e5e7eb' : 'none',
                        backgroundColor: originalRank === 1 ? '#fef3c7' : originalRank === 2 ? '#e0e7ff' : originalRank === 3 ? '#fed7aa' : 'white',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{
                          fontSize: isTopThree ? '1.5rem' : '1rem',
                          fontWeight: 700,
                          color: originalRank === 1 ? '#f59e0b' : originalRank === 2 ? '#6366f1' : originalRank === 3 ? '#f97316' : '#6b7280',
                          minWidth: '2rem'
                        }}>
                          {originalRank === 1 ? '🥇' : originalRank === 2 ? '🥈' : originalRank === 3 ? '🥉' : `${originalRank}.`}
                        </span>
                        <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{player.name}</span>
                      </div>
                      <span style={{
                        fontWeight: 700,
                        color: '#10b981',
                        fontSize: '1rem'
                      }}>
                        ${player.totalProfit.toFixed(0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', margin: 0 }}>
                {searchQuery 
                  ? `No students found matching "${searchQuery}"`
                  : 'No data yet. Start the game!'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Price Chart - Average Price Across Rounds */}
      {session?.config?.rounds && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>📊 Average Price Across Rounds</h3>
          <div style={{
            padding: '2rem',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: 'white'
          }}>
            <svg width="100%" height="350" viewBox="0 0 1000 350" preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
              {/* Y-axis */}
              <line x1="80" y1="30" x2="80" y2="280" stroke="#d1d5db" strokeWidth="2" />
              {/* X-axis */}
              <line x1="80" y1="280" x2="950" y2="280" stroke="#d1d5db" strokeWidth="2" />
              
              {/* Y-axis labels */}
              {(() => {
                // Calculate max from actual data (highest value + standard deviation)
                const dataMax = roundStats.length > 0 
                  ? Math.max(...roundStats.map(stat => stat.avg + stat.sd))
                  : (session?.config?.priceBounds?.max || 100);
                const dataMin = roundStats.length > 0
                  ? Math.min(...roundStats.map(stat => Math.max(0, stat.avg - stat.sd)))
                  : (session?.config?.priceBounds?.min || 0);
                
                // Add some padding (10%) to the range
                const padding = (dataMax - dataMin) * 0.1;
                const maxPrice = Math.ceil(dataMax + padding);
                const minPrice = Math.max(0, Math.floor(dataMin - padding));
                
                const yLabels = [];
                const numLabels = 6;
                for (let i = 0; i <= numLabels; i++) {
                  const value = minPrice + (maxPrice - minPrice) * (i / numLabels);
                  const y = 280 - (i / numLabels) * 250;
                  yLabels.push(
                    <g key={`ylabel-${i}`}>
                      <line x1="75" y1={y} x2="80" y2={y} stroke="#9ca3af" strokeWidth="1" />
                      <line x1="80" y1={y} x2="950" y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,4" />
                      <text x="70" y={y + 5} textAnchor="end" fill="#6b7280" fontSize="14" fontWeight="500">
                        {value.toFixed(0)}
                      </text>
                    </g>
                  );
                }
                return yLabels;
              })()}
              
              {/* X-axis labels for all rounds */}
              {(() => {
                const totalRounds = session.config.rounds;
                const xLabels = [];
                const chartWidth = 870; // 950 - 80
                for (let i = 1; i <= totalRounds; i++) {
                  const x = 80 + (i - 1) * (chartWidth / (totalRounds - 1 || 1));
                  xLabels.push(
                    <g key={`xlabel-${i}`}>
                      <line x1={x} y1="280" x2={x} y2="285" stroke="#9ca3af" strokeWidth="1" />
                      <text x={x} y="300" textAnchor="middle" fill="#6b7280" fontSize="13" fontWeight="500">
                        {i}
                      </text>
                    </g>
                  );
                }
                return xLabels;
              })()}
              
              {/* Data points and lines */}
              {(() => {
                // Calculate max/min from actual data (same as y-axis)
                const dataMax = roundStats.length > 0 
                  ? Math.max(...roundStats.map(stat => stat.avg + stat.sd))
                  : (session?.config?.priceBounds?.max || 100);
                const dataMin = roundStats.length > 0
                  ? Math.min(...roundStats.map(stat => Math.max(0, stat.avg - stat.sd)))
                  : (session?.config?.priceBounds?.min || 0);
                
                // Add some padding (10%) to the range
                const padding = (dataMax - dataMin) * 0.1;
                const maxPrice = Math.ceil(dataMax + padding);
                const minPrice = Math.max(0, Math.floor(dataMin - padding));
                const priceRange = maxPrice - minPrice;
                
                return roundStats.map((stat, index) => {
                const totalRounds = session.config.rounds;
                const chartWidth = 870;
                const x = 80 + (stat.round - 1) * (chartWidth / (totalRounds - 1 || 1));
                
                const yCenter = 280 - ((stat.avg - minPrice) / priceRange) * 250;
                const yTop = 280 - ((stat.avg + stat.sd - minPrice) / priceRange) * 250;
                const yBottom = 280 - ((stat.avg - stat.sd - minPrice) / priceRange) * 250;
                
                // Clamp values to chart bounds
                const clampedYTop = Math.max(30, Math.min(280, yTop));
                const clampedYBottom = Math.max(30, Math.min(280, yBottom));
                const clampedYCenter = Math.max(30, Math.min(280, yCenter));
                
                return (
                  <g key={stat.round}>
                    {/* Error bar */}
                    <line
                      x1={x}
                      y1={clampedYTop}
                      x2={x}
                      y2={clampedYBottom}
                      stroke="#94a3b8"
                      strokeWidth="3"
                    />
                    {/* Top cap */}
                    <line
                      x1={x - 6}
                      y1={clampedYTop}
                      x2={x + 6}
                      y2={clampedYTop}
                      stroke="#94a3b8"
                      strokeWidth="3"
                    />
                    {/* Bottom cap */}
                    <line
                      x1={x - 6}
                      y1={clampedYBottom}
                      x2={x + 6}
                      y2={clampedYBottom}
                      stroke="#94a3b8"
                      strokeWidth="3"
                    />
                    {/* Line to next point */}
                    {index < roundStats.length - 1 && roundStats[index + 1].round === stat.round + 1 && (
                      (() => {
                        const nextStat = roundStats[index + 1];
                        const nextX = 80 + (nextStat.round - 1) * (chartWidth / (totalRounds - 1 || 1));
                        const nextYCenter = 280 - ((nextStat.avg - minPrice) / priceRange) * 250;
                        const clampedNextYCenter = Math.max(30, Math.min(280, nextYCenter));
                        return (
                          <line
                            x1={x}
                            y1={clampedYCenter}
                            x2={nextX}
                            y2={clampedNextYCenter}
                            stroke="#3b82f6"
                            strokeWidth="3"
                          />
                        );
                      })()
                    )}
                    {/* Data point */}
                    <circle
                      cx={x}
                      cy={clampedYCenter}
                      r="6"
                      fill="#3b82f6"
                      stroke="white"
                      strokeWidth="2"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredPoint(stat.round)}
                      onMouseLeave={() => setHoveredPoint(null)}
                    />
                    
                    {/* Tooltip */}
                    {hoveredPoint === stat.round && (
                      <g>
                        <rect
                          x={x - 60}
                          y={clampedYCenter - 45}
                          width="120"
                          height="35"
                          fill="rgba(0, 0, 0, 0.85)"
                          rx="4"
                          ry="4"
                        />
                        <text
                          x={x}
                          y={clampedYCenter - 30}
                          textAnchor="middle"
                          fill="white"
                          fontSize="11"
                          fontWeight="600"
                        >
                          Round {stat.round}
                        </text>
                        <text
                          x={x}
                          y={clampedYCenter - 15}
                          textAnchor="middle"
                          fill="white"
                          fontSize="13"
                          fontWeight="700"
                        >
                          ${stat.avg.toFixed(2)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              });
              })()}
              
              {/* Axis labels */}
              <text x="500" y="330" textAnchor="middle" fill="#374151" fontSize="16" fontWeight="600">
                Round
              </text>
              <text x="30" y="155" textAnchor="middle" fill="#374151" fontSize="16" fontWeight="600" transform="rotate(-90 30 155)">
                Price
              </text>
            </svg>
          </div>
        </div>
      )}

      {/* Pair Profit Table */}
      {pairProfits.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>💰 Total Profit by Pair</h3>
          
          {/* Search Box */}
          <div style={{ marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="🔍 Search pairs..."
              value={pairSearchQuery}
              onChange={(e) => setPairSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
            />
          </div>
          
          <div style={{
            maxHeight: '500px',
            overflowY: 'auto',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: 'white',
            position: 'relative'
          }}>
            {filteredPairProfits.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: '#6b7280', margin: 0 }}>
                {pairSearchQuery 
                  ? `No pairs found matching "${pairSearchQuery}"`
                  : 'No pair data available'}
              </p>
            ) : (
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f9fafb', zIndex: 1 }}>
                  <tr>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '2px solid #d1d5db' }}>Rank</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', borderBottom: '2px solid #d1d5db' }}>Pair</th>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #d1d5db' }}>Player A</th>
                    <th style={{ padding: '0.75rem', borderBottom: '2px solid #d1d5db' }}>Player B</th>
                    <th style={{ textAlign: 'right', padding: '0.75rem', borderBottom: '2px solid #d1d5db' }}>Total Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPairProfits.map((pair, index) => {
                    // Find original rank in the full pairProfits array
                    const originalRank = pairProfits.findIndex(p => p.pairId === pair.pairId) + 1;
                    const isTopThree = originalRank <= 3;
                    const colors = ['#fef3c7', '#e0e7ff', '#fed7aa', 'white'];
                    const rankColors = ['#f59e0b', '#6366f1', '#f97316', '#6b7280'];
                    const backgroundColor = isTopThree ? colors[originalRank - 1] : colors[3];
                    const rankColor = isTopThree ? rankColors[originalRank - 1] : rankColors[3];
                    const isHovered = hoveredPair === pair.pairId;
                  
                  return (
                    <tr 
                      key={pair.pairId}
                      style={{ 
                        backgroundColor,
                        transition: 'all 0.2s',
                        position: 'relative'
                      }}
                    >
                      <td 
                        style={{ 
                          textAlign: 'center', 
                          fontWeight: 700, 
                          fontSize: '1.2rem', 
                          color: rankColor, 
                          padding: '0.75rem', 
                          borderBottom: '1px solid #e5e7eb',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s'
                        }}
                        onMouseEnter={() => setHoveredPair(pair.pairId)}
                        onMouseLeave={() => setHoveredPair(null)}
                      >
                        {originalRank === 1 ? '🥇' : originalRank === 2 ? '🥈' : originalRank === 3 ? '🥉' : originalRank}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 600, fontSize: '1rem', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                        Pair {pair.pairId.toString().replace('pair-', '')}
                      </td>
                      <td style={{ fontWeight: 500, padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                        👤 {pair.playerA}
                      </td>
                      <td style={{ fontWeight: 500, padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                        👤 {pair.playerB}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '1.1rem', color: '#10b981', padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                        ${pair.totalProfit.toFixed(0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {/* Individual Player Profits by Pair - Only show for completed games */}
      {session?.status === 'complete' && individualProfits.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>👥 Individual Player Profits by Pair</h3>
          <div style={{
            padding: '2rem',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: 'white'
          }}>
            <svg width="100%" height="400" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMid meet">
              {/* Y-axis */}
              <line x1="80" y1="30" x2="80" y2="330" stroke="#d1d5db" strokeWidth="2" />
              {/* X-axis */}
              <line x1="80" y1="330" x2="950" y2="330" stroke="#d1d5db" strokeWidth="2" />
              
              {/* Y-axis labels (Profit) */}
              {(() => {
                const allProfits = individualProfits.flatMap(p => [p.profitA, p.profitB]);
                const maxProfit = Math.max(...allProfits, 0);
                const minProfit = Math.min(...allProfits, 0);
                const profitRange = maxProfit - minProfit || 1;
                const yLabels = [];
                const numLabels = 6;
                
                for (let i = 0; i <= numLabels; i++) {
                  const value = minProfit + (profitRange * i / numLabels);
                  const y = 330 - (i / numLabels) * 300;
                  yLabels.push(
                    <g key={`ylabel-${i}`}>
                      <line x1="75" y1={y} x2="80" y2={y} stroke="#9ca3af" strokeWidth="1" />
                      <line x1="80" y1={y} x2="950" y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,4" />
                      <text x="72" y={y + 5} textAnchor="end" fill="#6b7280" fontSize="13" fontWeight="500">
                        ${value.toFixed(0)}
                      </text>
                    </g>
                  );
                }
                return yLabels;
              })()}
              
              {/* X-axis labels (Pairs) */}
              {individualProfits.map((pair, index) => {
                const numPairs = individualProfits.length;
                const chartWidth = 870;
                const spacing = chartWidth / (numPairs + 1);
                const x = 80 + spacing * (index + 1);
                
                return (
                  <g key={`xlabel-${pair.pairIndex}`}>
                    <line x1={x} y1="330" x2={x} y2="335" stroke="#9ca3af" strokeWidth="1" />
                    <text x={x} y="350" textAnchor="middle" fill="#6b7280" fontSize="13" fontWeight="600">
                      {pair.pairIndex}
                    </text>
                  </g>
                );
              })}
              
              {/* Data points for each pair */}
              {individualProfits.map((pair, index) => {
                const allProfits = individualProfits.flatMap(p => [p.profitA, p.profitB]);
                const maxProfit = Math.max(...allProfits, 0);
                const minProfit = Math.min(...allProfits, 0);
                const profitRange = maxProfit - minProfit || 1;
                
                const numPairs = individualProfits.length;
                const chartWidth = 870;
                const spacing = chartWidth / (numPairs + 1);
                const x = 80 + spacing * (index + 1);
                
                const yA = 330 - ((pair.profitA - minProfit) / profitRange) * 300;
                const yB = 330 - ((pair.profitB - minProfit) / profitRange) * 300;
                
                return (
                  <g key={`points-${pair.pairIndex}`}>
                    {/* Vertical line connecting the two players */}
                    <line
                      x1={x}
                      y1={yA}
                      x2={x}
                      y2={yB}
                      stroke="#cbd5e1"
                      strokeWidth="2"
                      strokeDasharray="4,4"
                    />
                    
                    {/* Player A point (blue) */}
                    <circle
                      cx={x}
                      cy={yA}
                      r="8"
                      fill="#3b82f6"
                      stroke="white"
                      strokeWidth="2"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredPlayerPoint(`${pair.pairIndex}-A`)}
                      onMouseLeave={() => setHoveredPlayerPoint(null)}
                    />
                    
                    {/* Player B point (green) */}
                    <circle
                      cx={x}
                      cy={yB}
                      r="8"
                      fill="#10b981"
                      stroke="white"
                      strokeWidth="2"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredPlayerPoint(`${pair.pairIndex}-B`)}
                      onMouseLeave={() => setHoveredPlayerPoint(null)}
                    />
                  </g>
                );
              })}
              
              {/* Tooltips - rendered last so they're always on top */}
              {individualProfits.map((pair, index) => {
                const allProfits = individualProfits.flatMap(p => [p.profitA, p.profitB]);
                const maxProfit = Math.max(...allProfits, 0);
                const minProfit = Math.min(...allProfits, 0);
                const profitRange = maxProfit - minProfit || 1;
                
                const numPairs = individualProfits.length;
                const chartWidth = 870;
                const spacing = chartWidth / (numPairs + 1);
                const x = 80 + spacing * (index + 1);
                
                const yA = 330 - ((pair.profitA - minProfit) / profitRange) * 300;
                const yB = 330 - ((pair.profitB - minProfit) / profitRange) * 300;
                
                return (
                  <g key={`tooltips-${pair.pairIndex}`}>
                    {/* Tooltip for Player A */}
                    {hoveredPlayerPoint === `${pair.pairIndex}-A` && (
                      <g>
                        <rect
                          x={x - 85}
                          y={yA - 60}
                          width="170"
                          height="35"
                          fill="rgba(59, 130, 246, 0.95)"
                          rx="4"
                          ry="4"
                        />
                        <text
                          x={x}
                          y={yA - 40}
                          textAnchor="middle"
                          fill="white"
                          fontSize="12"
                          fontWeight="600"
                        >
                          {pair.playerA} (Pair {pair.pairIndex})
                        </text>
                      </g>
                    )}
                    
                    {/* Tooltip for Player B */}
                    {hoveredPlayerPoint === `${pair.pairIndex}-B` && (
                      <g>
                        <rect
                          x={x - 85}
                          y={yB + 20}
                          width="170"
                          height="35"
                          fill="rgba(16, 185, 129, 0.95)"
                          rx="4"
                          ry="4"
                        />
                        <text
                          x={x}
                          y={yB + 42}
                          textAnchor="middle"
                          fill="white"
                          fontSize="12"
                          fontWeight="600"
                        >
                          {pair.playerB} (Pair {pair.pairIndex})
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
              
              {/* Legend */}
              <g transform="translate(800, 370)">
                <circle cx="10" cy="0" r="6" fill="#3b82f6" stroke="white" strokeWidth="2" />
                <text x="20" y="5" fill="#374151" fontSize="12" fontWeight="500">Player A</text>
                
                <circle cx="100" cy="0" r="6" fill="#10b981" stroke="white" strokeWidth="2" />
                <text x="110" y="5" fill="#374151" fontSize="12" fontWeight="500">Player B</text>
              </g>
              
              {/* Axis labels */}
              <text x="30" y="180" textAnchor="middle" fill="#6b7280" fontSize="14" fontWeight="600" transform="rotate(-90, 30, 180)">
                Profit ($)
              </text>
              <text x="515" y="385" textAnchor="middle" fill="#6b7280" fontSize="14" fontWeight="600">
                Pairs
              </text>
            </svg>
          </div>
        </div>
      )}

      {/* End Session Confirmation Modal */}
      {showEndConfirm && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
          onClick={() => setShowEndConfirm(false)}
        >
          <div 
            style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              maxWidth: '500px',
              boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, color: '#dc2626' }}>⚠️ End Session?</h2>
            <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>
              Are you sure you want to end this session?
            </p>
            {session?.status === 'running' && (
              <div style={{
                padding: '1rem',
                backgroundColor: '#fef3c7',
                borderLeft: '4px solid #f59e0b',
                marginBottom: '1.5rem',
                borderRadius: '4px'
              }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
                  ⚠️ WARNING: The game is still in progress!
                </p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                  Ending now will stop the current round and mark the session as complete.
                  All students will be notified that the session has ended.
                </p>
              </div>
            )}
            {session?.status === 'lobby' && (
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem' }}>
                The session hasn't started yet. Students will see that it has been ended.
              </p>
            )}
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowEndConfirm(false)}
                style={{
                  padding: '0.5rem 1.5rem',
                  fontSize: '1rem',
                  backgroundColor: '#e5e7eb',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEnd}
                style={{
                  padding: '0.5rem 1.5rem',
                  fontSize: '1rem',
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                End Session
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Price History Tooltip - Rendered at root level */}
      {hoveredPair && pairProfits.find(p => p.pairId === hoveredPair) && (() => {
        const pair = pairProfits.find(p => p.pairId === hoveredPair);
        return pair && pair.priceHistoryA && pair.priceHistoryA.length > 0 && (
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'white',
            border: '3px solid #3b82f6',
            borderRadius: '8px',
            padding: '1.5rem',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
            zIndex: 999999,
            minWidth: '500px',
            maxWidth: '700px',
            pointerEvents: 'none'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '0.9rem', color: '#374151' }}>
              💰 Price History - {pair.playerA} & {pair.playerB}
            </div>
            
            {/* Price Chart */}
            <div style={{ marginBottom: '1rem' }}>
              <svg width="100%" height="200" viewBox="0 0 500 200" preserveAspectRatio="xMidYMid meet">
                {/* Axes */}
                <line x1="50" y1="20" x2="50" y2="160" stroke="#d1d5db" strokeWidth="2" />
                <line x1="50" y1="160" x2="470" y2="160" stroke="#d1d5db" strokeWidth="2" />
                
                {/* Calculate scales */}
                {(() => {
                  const allPrices = [...pair.priceHistoryA, ...pair.priceHistoryB];
                  const minPrice = Math.min(...allPrices);
                  const maxPrice = Math.max(...allPrices);
                  const priceRange = maxPrice - minPrice || 1;
                  const numRounds = pair.priceHistoryA.length;
                  const chartWidth = 420;
                  const spacing = chartWidth / Math.max(numRounds - 1, 1);
                  
                  return (
                    <>
                      {/* Y-axis labels */}
                      {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
                        const value = minPrice + priceRange * ratio;
                        const y = 160 - (ratio * 140);
                        return (
                          <g key={ratio}>
                            <line x1="45" y1={y} x2="50" y2={y} stroke="#9ca3af" strokeWidth="1" />
                            <text x="42" y={y + 3} textAnchor="end" fill="#6b7280" fontSize="10">
                              ${value.toFixed(0)}
                            </text>
                          </g>
                        );
                      })}
                      
                      {/* X-axis labels (rounds) */}
                      {pair.priceHistoryA.map((_, i) => {
                        const x = 50 + (i * spacing);
                        return (
                          <g key={i}>
                            <line x1={x} y1="160" x2={x} y2="165" stroke="#9ca3af" strokeWidth="1" />
                            <text x={x} y="177" textAnchor="middle" fill="#6b7280" fontSize="10">
                              R{i + 1}
                            </text>
                          </g>
                        );
                      })}
                      
                      {/* Player A line (blue) */}
                      {pair.priceHistoryA.map((price, i) => {
                        if (i === 0) return null;
                        const x1 = 50 + ((i - 1) * spacing);
                        const y1 = 160 - ((pair.priceHistoryA[i - 1] - minPrice) / priceRange) * 140;
                        const x2 = 50 + (i * spacing);
                        const y2 = 160 - ((price - minPrice) / priceRange) * 140;
                        return (
                          <line
                            key={`a-${i}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke="#3b82f6"
                            strokeWidth="3"
                          />
                        );
                      })}
                      
                      {/* Player A points */}
                      {pair.priceHistoryA.map((price, i) => {
                        const x = 50 + (i * spacing);
                        const y = 160 - ((price - minPrice) / priceRange) * 140;
                        return (
                          <circle
                            key={`a-point-${i}`}
                            cx={x}
                            cy={y}
                            r="4"
                            fill="#3b82f6"
                            stroke="white"
                            strokeWidth="2"
                          />
                        );
                      })}
                      
                      {/* Player B line (orange) */}
                      {pair.priceHistoryB.map((price, i) => {
                        if (i === 0) return null;
                        const x1 = 50 + ((i - 1) * spacing);
                        const y1 = 160 - ((pair.priceHistoryB[i - 1] - minPrice) / priceRange) * 140;
                        const x2 = 50 + (i * spacing);
                        const y2 = 160 - ((price - minPrice) / priceRange) * 140;
                        return (
                          <line
                            key={`b-${i}`}
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke="#f97316"
                            strokeWidth="3"
                          />
                        );
                      })}
                      
                      {/* Player B points */}
                      {pair.priceHistoryB.map((price, i) => {
                        const x = 50 + (i * spacing);
                        const y = 160 - ((price - minPrice) / priceRange) * 140;
                        return (
                          <circle
                            key={`b-point-${i}`}
                            cx={x}
                            cy={y}
                            r="4"
                            fill="#f97316"
                            stroke="white"
                            strokeWidth="2"
                          />
                        );
                      })}
                      
                      {/* Legend */}
                      <g transform="translate(330, 10)">
                        <circle cx="5" cy="0" r="4" fill="#3b82f6" stroke="white" strokeWidth="1" />
                        <text x="12" y="3" fill="#1e40af" fontSize="10" fontWeight="600">{pair.playerA.split(' ')[0]}</text>
                        <circle cx="5" cy="15" r="4" fill="#f97316" stroke="white" strokeWidth="1" />
                        <text x="12" y="18" fill="#92400e" fontSize="10" fontWeight="600">{pair.playerB.split(' ')[0]}</text>
                      </g>
                    </>
                  );
                })()}
              </svg>
            </div>
            
            {/* Price & Profit Table */}
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85rem'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f3f4f6' }}>
                  <th style={{ 
                    padding: '0.5rem',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: '#374151',
                    borderBottom: '2px solid #d1d5db'
                  }}>
                    Player
                  </th>
                  {pair.priceHistoryA.map((_, i) => (
                    <th key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#374151',
                      borderBottom: '2px solid #d1d5db'
                    }}>
                      R{i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Price Section Header */}
                <tr style={{ backgroundColor: '#e5e7eb' }}>
                  <td colSpan={pair.priceHistoryA.length + 1} style={{
                    padding: '0.3rem 0.5rem',
                    fontWeight: 700,
                    color: '#374151',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    borderBottom: '1px solid #d1d5db'
                  }}>
                    PRICES
                  </td>
                </tr>
                
                {/* Player A Prices */}
                <tr style={{ backgroundColor: '#dbeafe' }}>
                  <td style={{
                    padding: '0.5rem',
                    fontWeight: 600,
                    color: '#1e40af',
                    borderBottom: '1px solid #d1d5db'
                  }}>
                    {pair.playerA}
                  </td>
                  {pair.priceHistoryA.map((price, i) => (
                    <td key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#1f2937',
                      borderBottom: '1px solid #d1d5db'
                    }}>
                      ${price.toFixed(1)}
                    </td>
                  ))}
                </tr>
                
                {/* Player B Prices */}
                <tr style={{ backgroundColor: '#fed7aa' }}>
                  <td style={{
                    padding: '0.5rem',
                    fontWeight: 600,
                    color: '#92400e',
                    borderBottom: '2px solid #9ca3af'
                  }}>
                    {pair.playerB}
                  </td>
                  {pair.priceHistoryB.map((price, i) => (
                    <td key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#1f2937',
                      borderBottom: '2px solid #9ca3af'
                    }}>
                      ${price.toFixed(1)}
                    </td>
                  ))}
                </tr>
                
                {/* Profit Section Header */}
                <tr style={{ backgroundColor: '#e5e7eb' }}>
                  <td colSpan={pair.priceHistoryA.length + 1} style={{
                    padding: '0.3rem 0.5rem',
                    fontWeight: 700,
                    color: '#374151',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    borderBottom: '1px solid #d1d5db'
                  }}>
                    PROFITS
                  </td>
                </tr>
                
                {/* Player A Profits */}
                <tr style={{ backgroundColor: '#dbeafe' }}>
                  <td style={{
                    padding: '0.5rem',
                    fontWeight: 600,
                    color: '#1e40af',
                    borderBottom: '1px solid #d1d5db'
                  }}>
                    {pair.playerA}
                  </td>
                  {pair.profitHistoryA && pair.profitHistoryA.map((profit, i) => (
                    <td key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#10b981',
                      borderBottom: '1px solid #d1d5db'
                    }}>
                      ${profit.toFixed(0)}
                    </td>
                  ))}
                </tr>
                
                {/* Player B Profits */}
                <tr style={{ backgroundColor: '#fed7aa' }}>
                  <td style={{
                    padding: '0.5rem',
                    fontWeight: 600,
                    color: '#92400e',
                    borderBottom: '2px solid #9ca3af'
                  }}>
                    {pair.playerB}
                  </td>
                  {pair.profitHistoryB && pair.profitHistoryB.map((profit, i) => (
                    <td key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#10b981',
                      borderBottom: '2px solid #9ca3af'
                    }}>
                      ${profit.toFixed(0)}
                    </td>
                  ))}
                </tr>
                
                {/* Market Share Section Header */}
                <tr style={{ backgroundColor: '#e5e7eb' }}>
                  <td colSpan={pair.priceHistoryA.length + 1} style={{
                    padding: '0.3rem 0.5rem',
                    fontWeight: 700,
                    color: '#374151',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    borderBottom: '1px solid #d1d5db'
                  }}>
                    MARKET SHARES
                  </td>
                </tr>
                
                {/* Player A Market Shares */}
                <tr style={{ backgroundColor: '#dbeafe' }}>
                  <td style={{
                    padding: '0.5rem',
                    fontWeight: 600,
                    color: '#1e40af',
                    borderBottom: '1px solid #d1d5db'
                  }}>
                    {pair.playerA}
                  </td>
                  {pair.shareHistoryA && pair.shareHistoryA.map((share, i) => (
                    <td key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#3b82f6',
                      borderBottom: '1px solid #d1d5db'
                    }}>
                      {(share * 100).toFixed(1)}%
                    </td>
                  ))}
                </tr>
                
                {/* Player B Market Shares */}
                <tr style={{ backgroundColor: '#fed7aa' }}>
                  <td style={{
                    padding: '0.5rem',
                    fontWeight: 600,
                    color: '#92400e'
                  }}>
                    {pair.playerB}
                  </td>
                  {pair.shareHistoryB && pair.shareHistoryB.map((share, i) => (
                    <td key={i} style={{
                      padding: '0.5rem',
                      textAlign: 'center',
                      fontWeight: 600,
                      color: '#3b82f6'
                    }}>
                      {(share * 100).toFixed(1)}%
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
