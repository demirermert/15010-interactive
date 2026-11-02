import React, { useState, useEffect } from 'react';

export function StudentView({
  sessionCode,
  sessionStatus,
  currentRound,
  roundActive,
  timer,
  priceBounds,
  onSubmitPrice,
  latestResult,
  history,
  hasSubmitted,
  personalLink,
  nextRoundCountdown,
  session,
  leaderboard,
  allRounds,
  chatMessages,
  onSendChatMessage,
  currentSocketId,
  opponentName
}) {
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [chatInput, setChatInput] = useState('');

  useEffect(() => {
    setPrice('');
    setError('');
  }, [currentRound]);

  const handleSubmit = event => {
    event.preventDefault();
    const numeric = Number(price);
    if (!Number.isFinite(numeric)) {
      setError('Enter a valid number');
      return;
    }
    if (numeric < priceBounds.min || numeric > priceBounds.max) {
      setError(`Price must be between ${priceBounds.min} and ${priceBounds.max}`);
      return;
    }
    setError('');
    onSubmitPrice(numeric);
  };

  return (
    <div className="card">
      {/* Session Complete Message */}
      {sessionStatus === 'complete' && (
        <div style={{
          padding: '1.5rem',
          backgroundColor: '#dbeafe',
          borderRadius: '8px',
          borderLeft: '4px solid #3b82f6',
          marginBottom: '1.5rem',
          textAlign: 'center'
        }}>
          <h2 style={{ margin: '0 0 0.5rem 0', color: '#1e40af', fontSize: '1.5rem' }}>
            🎉 Session Complete!
          </h2>
          <p style={{ margin: 0, color: '#1e3a8a', fontSize: '1rem' }}>
            The instructor has ended this session. Thank you for participating!
          </p>
        </div>
      )}
      
      {/* Waiting for Game to Start */}
      {sessionStatus === 'lobby' && (
        <div style={{ marginBottom: '1.5rem' }}>
          {/* Status Banner */}
          <div style={{
            padding: '1.5rem',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            borderLeft: '4px solid #f59e0b',
            textAlign: 'center',
            marginBottom: '1.5rem'
          }}>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#92400e', fontSize: '1.5rem' }}>
              ⏳ Waiting to Start
            </h2>
            <p style={{ margin: '0.5rem 0 0 0', color: '#78350f', fontSize: '1rem' }}>
              Waiting for other students to join and for the instructor to start the game...
            </p>
          </div>

          {/* Game Instructions */}
          <div style={{
            padding: '2rem',
            backgroundColor: 'white',
            borderRadius: '8px',
            border: '2px solid #e5e7eb'
          }}>
            <h3 style={{ marginTop: 0, color: '#1f2937', fontSize: '1.25rem' }}>
              📚 How to Play
            </h3>
            
            <div style={{ color: '#374151', lineHeight: '1.6', marginBottom: '1.5rem' }}>
              <p style={{ marginBottom: '1rem' }}>
                You are competing in a <strong>pricing game</strong> where you'll be paired with another student.{' '}
                {session?.config?.hideRoundCount ? (
                  <>The game will continue for an unknown number of rounds and then it will end.</>
                ) : session?.config?.rounds ? (
                  <>You&apos;ll play for {session.config.rounds} round{session.config.rounds > 1 ? 's' : ''}.</>
                ) : (
                  <>You&apos;ll play for multiple rounds.</>
                )}
              </p>
              
              <p style={{ marginBottom: '1rem' }}>
                In each round, you and your opponent will <strong>simultaneously set prices</strong> for similar but differentiated products. 
                {(() => {
                  const roundTime = session?.config?.roundTime;
                  if (Array.isArray(roundTime) && roundTime.length > 0) {
                    const minTime = Math.min(...roundTime);
                    const maxTime = Math.max(...roundTime);
                    if (minTime === maxTime) {
                      return <span>You have <strong>{minTime} seconds</strong> per round to make your decision.</span>;
                    } else {
                      return <span>You will have <strong>{minTime}-{maxTime} seconds</strong> per round to make your decision, depending on the round.</span>;
                    }
                  } else {
                    return <span>You have <strong>{roundTime || 60} seconds</strong> per round to make your decision.</span>;
                  }
                })()}
              </p>

              <p style={{ marginBottom: '1rem' }}>
                <strong>Your goal:</strong> Maximize your total profit across all rounds by choosing the optimal price. 
                The demand you receive depends on both your price and your opponent's price. 
                Note that the <strong>marginal cost is zero</strong>, so your profit equals price times quantity sold. 
                Remember, your goal is to <strong>maximize your own profit</strong>, not necessarily to beat your competitor.
              </p>

              <p style={{ marginBottom: '1rem' }}>
                <strong>After each round,</strong> you will see your price, your opponent's price, market shares, and profits from that round. 
                Use this information to adjust your strategy for the next round!
              </p>

              <p style={{ marginBottom: '0' }}>
                <strong>How it works:</strong> Customers have different preferences for the two products. 
                Lower prices attract more customers, but you also earn less per unit sold. 
                If you price too high compared to your opponent, customers will switch to their product. 
                Find the sweet spot!
              </p>
            </div>

            {/* Market Parameters - Only show if enabled */}
            {session?.config?.showModelParameters && session?.config && (
              <div style={{
                backgroundColor: '#f0f9ff',
                padding: '1.5rem',
                borderRadius: '8px',
                border: '1px solid #bfdbfe'
              }}>
                <h4 style={{ marginTop: 0, color: '#1e40af', fontSize: '1rem' }}>
                  📊 Market Parameters
                </h4>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '1rem',
                  fontSize: '0.9rem',
                  color: '#1e3a8a'
                }}>
                  {session.config.modelType === 'hotelling' ? (
                    <>
                      <div>
                        <strong>Travel Cost (t):</strong> ${session.config.travelCost} per unit distance
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Cost for consumers to travel
                        </div>
                      </div>
                      <div>
                        <strong>Consumer Valuation (V):</strong> ${session.config.consumerValue}
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Value for the product
                        </div>
                      </div>
                      <div>
                        <strong>Your Location (x₁):</strong> {session.config.x1}
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Position on [0, 100]
                        </div>
                      </div>
                      <div>
                        <strong>Opponent Location (x₂):</strong> {session.config.x2}
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          Position on [0, 100]
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <strong>Market Size:</strong> {session.config.marketSize} customers
                      </div>
                      <div>
                        <strong>Price Sensitivity (α):</strong> {session.config.alpha}
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          {session.config.alpha < 1 ? 'Low sensitivity' : session.config.alpha < 2 ? 'Moderate sensitivity' : 'High sensitivity'}
                        </div>
                      </div>
                      <div>
                        <strong>Product Differentiation (σ):</strong> {session.config.sigma}
                        <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
                          {session.config.sigma < 3 ? 'Very similar products' : session.config.sigma < 7 ? 'Moderately differentiated' : 'Highly differentiated'}
                        </div>
                      </div>
                    </>
                  )}
                  {!session.config.hideRoundCount && (
                    <div>
                      <strong>Number of Rounds:</strong> {session.config.rounds}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      <header style={{ marginBottom: '1.5rem' }}>
        {/* Centralized Round and Timer Display */}
        <div style={{ 
          textAlign: 'center', 
          padding: '1.5rem',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          marginBottom: '1rem'
        }}>
          <div style={{ 
            fontSize: '1.5rem', 
            fontWeight: 600,
            color: '#374151',
            marginBottom: (roundActive || (nextRoundCountdown !== null && nextRoundCountdown > 0)) ? '0.75rem' : 0
          }}>
            {sessionStatus === 'lobby' 
              ? 'Waiting to start...' 
              : session?.config?.hideRoundCount 
                ? `Round ${currentRound}` 
                : `Round ${currentRound} of ${session?.config?.rounds || 0}`
            }
          </div>
          {roundActive && timer > 0 && (
            <div style={{
              fontSize: '2.5rem',
              fontWeight: 700,
              color: timer <= 10 ? '#dc2626' : '#3b82f6',
              transition: 'color 0.3s ease'
            }}>
              {timer}s
            </div>
          )}
          {/* Show countdown in the same space when not in active round */}
          {nextRoundCountdown !== null && nextRoundCountdown > 0 && !roundActive && (
            <div style={{
              fontSize: '2.5rem',
              fontWeight: 700,
              color: '#f59e0b',
              transition: 'color 0.3s ease'
            }}>
              Next Round Starts: {nextRoundCountdown}s
            </div>
          )}
        </div>
      </header>

      {/* Opponent Name Display */}
      {session?.config?.showOpponentName && opponentName && sessionStatus === 'running' && (
        <div style={{
          padding: '1rem',
          backgroundColor: '#f0f9ff',
          borderRadius: '8px',
          borderLeft: '4px solid #3b82f6',
          marginBottom: '1rem',
          textAlign: 'center'
        }}>
          <p style={{ margin: 0, color: '#1e40af', fontWeight: 600 }}>
            👥 Paired with: <span style={{ color: '#3b82f6' }}>{opponentName}</span>
          </p>
        </div>
      )}

      {/* Chat Interface */}
      {session?.config?.enableChat && (sessionStatus === 'running' || sessionStatus === 'complete') && (
        <div style={{
          marginBottom: '1.5rem',
          border: '2px solid #e5e7eb',
          borderRadius: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '0.75rem',
            backgroundColor: '#f9fafb',
            borderBottom: '2px solid #e5e7eb',
            fontWeight: 600,
            color: '#374151'
          }}>
            💬 Chat with your opponent
          </div>
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            padding: '1rem',
            backgroundColor: 'white',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}>
            {(!chatMessages || chatMessages.length === 0) && (
              <p style={{ margin: 0, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' }}>
                No messages yet. Start the conversation!
              </p>
            )}
            {chatMessages && chatMessages.map((msg, idx) => {
              const isOwnMessage = msg.fromSocketId === currentSocketId;
              return (
                <div
                  key={idx}
                  style={{
                    alignSelf: isOwnMessage ? 'flex-end' : 'flex-start',
                    maxWidth: '70%'
                  }}
                >
                  <div style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    backgroundColor: isOwnMessage ? '#3b82f6' : '#e5e7eb',
                    color: isOwnMessage ? 'white' : '#374151'
                  }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                      {isOwnMessage ? 'You' : (opponentName || 'Opponent')}
                    </div>
                    <div>{msg.message}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (chatInput.trim() && onSendChatMessage && sessionStatus === 'running') {
                onSendChatMessage(chatInput.trim());
                setChatInput('');
              }
            }}
            style={{
              padding: '0.75rem',
              backgroundColor: '#f9fafb',
              borderTop: '2px solid #e5e7eb',
              display: 'flex',
              gap: '0.5rem'
            }}
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={sessionStatus === 'complete' ? 'Chat closed (session ended)' : 'Type a message...'}
              disabled={sessionStatus !== 'running'}
              style={{
                flex: 1,
                padding: '0.5rem',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                backgroundColor: sessionStatus !== 'running' ? '#f3f4f6' : 'white',
                cursor: sessionStatus !== 'running' ? 'not-allowed' : 'text'
              }}
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || sessionStatus !== 'running'}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: (chatInput.trim() && sessionStatus === 'running') ? '#3b82f6' : '#d1d5db',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: (chatInput.trim() && sessionStatus === 'running') ? 'pointer' : 'not-allowed',
                fontWeight: 600
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      {sessionStatus !== 'lobby' && sessionStatus !== 'complete' && !nextRoundCountdown && (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          gap: '2rem',
          padding: '2rem 0'
        }}>
          {/* Modern Price Input */}
          <div style={{
            width: '100%',
            maxWidth: '400px',
            textAlign: 'center'
          }}>
            <label 
              htmlFor="price-input" 
              style={{ 
                display: 'block',
                fontSize: '1.25rem',
                fontWeight: 600,
                color: '#374151',
                marginBottom: '1rem',
                letterSpacing: '-0.025em'
              }}
            >
              YOUR PRICE
            </label>
            
            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f9fafb',
              borderRadius: '16px',
              padding: '1.5rem',
              border: '2px solid #e5e7eb',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}>
              <span style={{
                fontSize: '3rem',
                fontWeight: 700,
                color: '#6b7280',
                marginRight: '0.75rem'
              }}>$</span>
              
          <input
            id="price-input"
            type="number"
            step="0.01"
            min={priceBounds.min}
            max={priceBounds.max}
            value={price}
            onChange={event => setPrice(event.target.value)}
            disabled={!roundActive || hasSubmitted}
                placeholder="0"
                style={{
                  fontSize: '3.5rem',
                  fontWeight: 700,
                  color: '#1f2937',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  width: '200px',
                  textAlign: 'center',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  MozAppearance: 'textfield'
                }}
                onWheel={(e) => e.target.blur()}
              />
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '0.75rem',
              fontSize: '0.875rem',
              color: '#6b7280',
              fontWeight: 500
            }}>
              <span>Min: ${priceBounds.min}</span>
              <span>Max: ${priceBounds.max}</span>
            </div>
            
            {error && (
              <div style={{ 
                marginTop: '1rem',
                color: '#dc2626',
                fontSize: '0.875rem',
                fontWeight: 600
              }}>
                {error}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button 
            onClick={handleSubmit}
            disabled={!roundActive || hasSubmitted}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '1.25rem 2rem',
              fontSize: '1.125rem',
              fontWeight: 700,
              color: 'white',
              backgroundColor: hasSubmitted ? '#10b981' : '#3b82f6',
              border: 'none',
              borderRadius: '12px',
              cursor: roundActive && !hasSubmitted ? 'pointer' : 'not-allowed',
              transition: 'all 0.3s',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
            onMouseEnter={(e) => {
              if (roundActive && !hasSubmitted) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 20px 25px -5px rgba(0, 0, 0, 0.2)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
            }}
          >
            {hasSubmitted ? '✓ Submitted' : 'Submit Price'}
          </button>
        </div>
      )}

      {hasSubmitted && roundActive && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '1rem', 
          backgroundColor: '#dbeafe', 
          borderRadius: '8px',
          borderLeft: '4px solid #3b82f6',
          textAlign: 'center'
        }}>
          <p style={{ margin: 0, color: '#1e40af', fontWeight: 600, fontSize: '1rem' }}>
            ⏳ Waiting for other students to submit their prices...
          </p>
          <p style={{ margin: '0.5rem 0 0 0', color: '#1e3a8a', fontSize: '0.875rem' }}>
            Results will appear when time runs out
          </p>
        </div>
      )}

      {latestResult && sessionStatus !== 'complete' && (
        <div style={{ marginTop: '1.5rem' }}>
          {/* Round Complete Badge */}
          <div style={{
            textAlign: 'center',
            marginBottom: '1.5rem'
          }}>
            <span style={{
              display: 'inline-block',
              padding: '0.5rem 1.5rem',
              backgroundColor: '#e5e7eb',
              color: '#374151',
              borderRadius: '8px',
              fontSize: '1rem',
              fontWeight: 600,
              marginBottom: '0.5rem'
            }}>
              Round {latestResult.round} Complete
            </span>
            <h2 style={{ 
              fontSize: '2rem', 
              fontWeight: 700,
              margin: '0.5rem 0 0 0',
              color: '#1f2937'
            }}>
              Previous Round Results
            </h2>
          </div>

          {/* Results Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            {/* You Card */}
            <div style={{
              backgroundColor: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: '12px',
              padding: '1.5rem',
              position: 'relative'
            }}>
              <div style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: '1.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                YOU
              </div>
              
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Price
                </div>
                <div style={{ 
                  fontSize: '1.75rem', 
                  fontWeight: 700,
                  color: '#1f2937'
                }}>
                  ${Number.isInteger(latestResult.price) ? latestResult.price : latestResult.price.toFixed(2)}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Market Share
                </div>
                <div style={{ 
                  fontSize: '1.75rem', 
                  fontWeight: 700,
                  color: '#3b82f6'
                }}>
                  {((latestResult.share || 0) * 100).toFixed(1)}%
                </div>
              </div>

              <div>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Profit
                </div>
                <div style={{ 
                  fontSize: '1.75rem', 
                  fontWeight: 700,
                  color: '#10b981'
                }}>
                  ${latestResult.profit.toFixed(0)}
                </div>
              </div>
            </div>

            {/* Opponent Card */}
            <div style={{
              backgroundColor: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: '12px',
              padding: '1.5rem',
              position: 'relative'
            }}>
              
              <div style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: '1.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {session?.config?.showOpponentName && latestResult?.opponentName 
                  ? latestResult.opponentName 
                  : 'OPPONENT'}
              </div>
              
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Price
                </div>
                <div style={{ 
                  fontSize: '1.75rem', 
                  fontWeight: 700,
                  color: '#1f2937'
                }}>
                  ${(latestResult.opponentPrice !== undefined && latestResult.opponentPrice !== null) 
                    ? (Number.isInteger(latestResult.opponentPrice) ? latestResult.opponentPrice : latestResult.opponentPrice.toFixed(2))
                    : '-'}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Market Share
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#3b82f6'
                }}>
                  {(latestResult.opponentShare !== undefined && latestResult.opponentShare !== null) ? (latestResult.opponentShare * 100).toFixed(1) + '%' : '-'}
                </div>
              </div>

              <div>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Profit
                </div>
                <div style={{ 
                  fontSize: '1.75rem', 
                  fontWeight: 700,
                  color: '#10b981'
                }}>
                  ${(latestResult.opponentProfit !== undefined && latestResult.opponentProfit !== null) ? latestResult.opponentProfit.toFixed(0) : '-'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Game Summary - Only show when game is complete */}
      {sessionStatus === 'complete' && history && history.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{
            textAlign: 'center',
            marginBottom: '1.5rem'
          }}>
            <h2 style={{ 
              fontSize: '1.75rem', 
              fontWeight: 700,
              margin: '0',
              color: '#1f2937'
            }}>
              🏁 Game Summary
            </h2>
          </div>

          {/* Summary Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            {/* Your Summary Card */}
            <div style={{
              backgroundColor: history.reduce((sum, item) => sum + (item.profit || 0), 0) >= 
                              history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0) ? '#ede9fe' : 'white',
              border: history.reduce((sum, item) => sum + (item.profit || 0), 0) >= 
                     history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0) ? '3px solid #8b5cf6' : '2px solid #e5e7eb',
              borderRadius: '12px',
              padding: '1.5rem',
              paddingTop: '2.5rem',
              position: 'relative'
            }}>
              {history.reduce((sum, item) => sum + (item.profit || 0), 0) >= 
               history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0) && (
                <div style={{
                  position: 'absolute',
                  top: '0.75rem',
                  right: '0.75rem',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  Winner
                </div>
              )}
              
              <div style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: '1.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                YOU
              </div>
              
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Average Price
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#1f2937'
                }}>
                  ${(history.reduce((sum, item) => sum + (item.price || 0), 0) / history.length).toFixed(2)}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Average Market Share
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#3b82f6'
                }}>
                  {(history.reduce((sum, item) => sum + ((item.share || 0) * 100), 0) / history.length).toFixed(1)}%
                </div>
              </div>

              <div>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Total Profit
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#10b981'
                }}>
                  ${history.reduce((sum, item) => sum + (item.profit || 0), 0).toFixed(0)}
                </div>
              </div>
            </div>

            {/* Opponent Summary Card */}
            <div style={{
              backgroundColor: history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0) > 
                              history.reduce((sum, item) => sum + (item.profit || 0), 0) ? '#ede9fe' : 'white',
              border: history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0) > 
                     history.reduce((sum, item) => sum + (item.profit || 0), 0) ? '3px solid #8b5cf6' : '2px solid #e5e7eb',
              borderRadius: '12px',
              padding: '1.5rem',
              paddingTop: '2.5rem',
              position: 'relative'
            }}>
              {history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0) > 
               history.reduce((sum, item) => sum + (item.profit || 0), 0) && (
                <div style={{
                  position: 'absolute',
                  top: '0.75rem',
                  right: '0.75rem',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  padding: '0.25rem 0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase'
                }}>
                  Winner
                </div>
              )}
              
              <div style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: '1.5rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {history && history.length > 0 && history[0]?.opponentName 
                  ? history[0].opponentName.toUpperCase() 
                  : 'OPPONENT'}
              </div>
              
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Average Price
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#1f2937'
                }}>
                  ${history.length > 0 && history[0].opponentPrice !== undefined
                    ? (history.reduce((sum, item) => sum + (item.opponentPrice || 0), 0) / history.length).toFixed(2)
                    : '-'}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Average Market Share
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#3b82f6'
                }}>
                  {history.length > 0 && history[0].opponentShare !== undefined
                    ? (history.reduce((sum, item) => sum + ((item.opponentShare || 0) * 100), 0) / history.length).toFixed(1) + '%'
                    : '-'}
                </div>
              </div>

              <div>
                <div style={{ 
                  fontSize: '0.875rem', 
                  color: '#6b7280',
                  marginBottom: '0.25rem'
                }}>
                  Total Profit
                </div>
                <div style={{ 
                  fontSize: '1.5rem', 
                  fontWeight: 700,
                  color: '#10b981'
                }}>
                  ${history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0).toFixed(0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ width: '100%', overflowX: 'visible' }}>
            <table className="table" style={{ 
              width: '100%', 
              fontSize: '0.875rem',
              tableLayout: 'fixed'
            }}>
              <thead>
                <tr>
                  <th style={{ width: '8%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>R</th>
                  <th style={{ width: '15%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>
                    <div>You</div>
                    <div>$</div>
                  </th>
                  <th style={{ width: '15%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>
                    <div>Opp</div>
                    <div>$</div>
                  </th>
                  <th style={{ width: '12%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>
                    <div>You</div>
                    <div>%</div>
                  </th>
                  <th style={{ width: '12%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>
                    <div>Opp</div>
                    <div>%</div>
                  </th>
                  <th style={{ width: '19%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>
                    <div>Your</div>
                    <div>Profit</div>
                  </th>
                  <th style={{ width: '19%', padding: '0.5rem 0.25rem', fontSize: '0.75rem', textAlign: 'center' }}>
                    <div>Opp</div>
                    <div>Profit</div>
                  </th>
                </tr>
              </thead>
              <tbody>
            {history.map(item => {
              const yourSharePct = (item.share || 0) * 100;
              const oppSharePct = (item.opponentShare || 0) * 100;
              const yourShareStr = yourSharePct >= 1 ? yourSharePct.toFixed(0) : yourSharePct.toFixed(1);
              const oppShareStr = oppSharePct >= 1 ? oppSharePct.toFixed(0) : oppSharePct.toFixed(1);
              
              return (
                  <tr key={item.round}>
                    <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}>{item.round}</td>
                    <td style={{ fontWeight: 600, padding: '0.5rem 0.25rem', textAlign: 'center' }}>{item.price.toFixed(1)}</td>
                    <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}>{item.opponentPrice?.toFixed(1) || '-'}</td>
                    <td style={{ fontWeight: 600, padding: '0.5rem 0.25rem', textAlign: 'center' }}>{yourShareStr}%</td>
                    <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}>{item.opponentShare !== undefined && item.opponentShare !== null ? oppShareStr + '%' : '-'}</td>
                    <td style={{ fontWeight: 600, color: '#10b981', padding: '0.5rem 0.25rem', textAlign: 'center' }}>${item.profit.toFixed(0)}</td>
                    <td style={{ color: '#6b7280', padding: '0.5rem 0.25rem', textAlign: 'center' }}>${item.opponentProfit?.toFixed(0) || '-'}</td>
                  </tr>
              );
            })}
                {/* Total Row */}
                <tr style={{ 
                  borderTop: '3px solid #374151',
                  backgroundColor: '#f9fafb',
                  fontWeight: 700
                }}>
                  <td style={{ fontWeight: 700, padding: '0.5rem 0.25rem', textAlign: 'center' }}>Total</td>
                  <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}></td>
                  <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}></td>
                  <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}></td>
                  <td style={{ padding: '0.5rem 0.25rem', textAlign: 'center' }}></td>
                  <td style={{ fontWeight: 700, color: '#10b981', fontSize: '1rem', padding: '0.5rem 0.25rem', textAlign: 'center' }}>
                    ${history.reduce((sum, item) => sum + (item.profit || 0), 0).toFixed(0)}
                  </td>
                  <td style={{ fontWeight: 700, color: '#6b7280', fontSize: '1rem', padding: '0.5rem 0.25rem', textAlign: 'center' }}>
                    ${history.reduce((sum, item) => sum + (item.opponentProfit || 0), 0).toFixed(0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Price History Chart */}
      {history && history.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3 style={{ 
            margin: '0 0 1rem 0',
            fontSize: '1.25rem',
            fontWeight: 600,
            color: '#1f2937'
          }}>
            📊 Price History
          </h3>
          <div className="price-chart-container" style={{
            padding: '1.5rem',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            backgroundColor: 'white'
          }}>
            <svg width="100%" height="400" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
              {/* Chart background */}
              <rect x="0" y="0" width="800" height="400" fill="white" />
              
              {/* Y-axis */}
              <line x1="80" y1="60" x2="80" y2="340" stroke="#d1d5db" strokeWidth="2" />
              {/* X-axis */}
              <line x1="80" y1="340" x2="760" y2="340" stroke="#d1d5db" strokeWidth="2" />
              
              {/* Y-axis labels (Price) */}
              {(() => {
                const allPrices = history.flatMap(h => [h.price || 0, h.opponentPrice || 0]);
                const maxPrice = Math.max(...allPrices, 0);
                const minPrice = Math.min(...allPrices, 0);
                const priceRange = maxPrice - minPrice || 1;
                const yLabels = [];
                const numLabels = 5;
                
                for (let i = 0; i <= numLabels; i++) {
                  const value = minPrice + (priceRange * i / numLabels);
                  const y = 340 - (i / numLabels) * 280;
                  yLabels.push(
                    <g key={`ylabel-${i}`}>
                      <line x1="75" y1={y} x2="80" y2={y} stroke="#9ca3af" strokeWidth="1" />
                      <line x1="80" y1={y} x2="760" y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,4" />
                      <text x="70" y={y + 5} textAnchor="end" fill="#6b7280" className="chart-ylabel">
                        ${value.toFixed(0)}
                      </text>
                    </g>
                  );
                }
                return yLabels;
              })()}
              
              {/* X-axis labels (Rounds) */}
              {history.map((item, index) => {
                const numRounds = history.length;
                const chartWidth = 680;
                const spacing = chartWidth / (numRounds > 1 ? numRounds - 1 : 1);
                const x = 80 + (numRounds > 1 ? spacing * index : chartWidth / 2);
                
                return (
                  <g key={`xlabel-${item.round}`}>
                    <line x1={x} y1="340" x2={x} y2="345" stroke="#9ca3af" strokeWidth="1" />
                    <text x={x} y="362" textAnchor="middle" fill="#6b7280" className="chart-xlabel">
                      R{item.round}
                    </text>
                  </g>
                );
              })}
              
              {/* Your prices line (blue) */}
              {history.length > 1 && (
                <polyline
                  points={history.map((item, index) => {
                    const allPrices = history.flatMap(h => [h.price || 0, h.opponentPrice || 0]);
                    const maxPrice = Math.max(...allPrices, 0);
                    const minPrice = Math.min(...allPrices, 0);
                    const priceRange = maxPrice - minPrice || 1;
                    
                    const numRounds = history.length;
                    const chartWidth = 680;
                    const spacing = chartWidth / (numRounds - 1);
                    const x = 80 + spacing * index;
                    const y = 340 - ((item.price - minPrice) / priceRange) * 280;
                    
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              
              {/* Opponent prices line (orange) */}
              {history.length > 1 && (
                <polyline
                  points={history.map((item, index) => {
                    const allPrices = history.flatMap(h => [h.price || 0, h.opponentPrice || 0]);
                    const maxPrice = Math.max(...allPrices, 0);
                    const minPrice = Math.min(...allPrices, 0);
                    const priceRange = maxPrice - minPrice || 1;
                    
                    const numRounds = history.length;
                    const chartWidth = 680;
                    const spacing = chartWidth / (numRounds - 1);
                    const x = 80 + spacing * index;
                    const y = 340 - ((item.opponentPrice - minPrice) / priceRange) * 280;
                    
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              
              {/* Data points for your prices */}
              {history.map((item, index) => {
                const allPrices = history.flatMap(h => [h.price || 0, h.opponentPrice || 0]);
                const maxPrice = Math.max(...allPrices, 0);
                const minPrice = Math.min(...allPrices, 0);
                const priceRange = maxPrice - minPrice || 1;
                
                const numRounds = history.length;
                const chartWidth = 680;
                const spacing = chartWidth / (numRounds > 1 ? numRounds - 1 : 1);
                const x = 80 + (numRounds > 1 ? spacing * index : chartWidth / 2);
                const y = 340 - ((item.price - minPrice) / priceRange) * 280;
                
                return (
                  <circle
                    key={`your-${item.round}`}
                    cx={x}
                    cy={y}
                    r="5"
                    fill="#3b82f6"
                    stroke="white"
                    strokeWidth="2"
                  />
                );
              })}
              
              {/* Data points for opponent prices */}
              {history.map((item, index) => {
                const allPrices = history.flatMap(h => [h.price || 0, h.opponentPrice || 0]);
                const maxPrice = Math.max(...allPrices, 0);
                const minPrice = Math.min(...allPrices, 0);
                const priceRange = maxPrice - minPrice || 1;
                
                const numRounds = history.length;
                const chartWidth = 680;
                const spacing = chartWidth / (numRounds > 1 ? numRounds - 1 : 1);
                const x = 80 + (numRounds > 1 ? spacing * index : chartWidth / 2);
                const y = 340 - ((item.opponentPrice - minPrice) / priceRange) * 280;
                
                return (
                  <circle
                    key={`opp-${item.round}`}
                    cx={x}
                    cy={y}
                    r="5"
                    fill="#f59e0b"
                    stroke="white"
                    strokeWidth="2"
                  />
                );
              })}
              
              {/* Legend */}
              <g transform="translate(550, 10)">
                <circle cx="10" cy="0" r="6" fill="#3b82f6" stroke="white" strokeWidth="2" />
                <text x="22" y="6" fill="#374151" className="chart-legend">Your Price</text>
                
                <circle cx="10" cy="28" r="6" fill="#f59e0b" stroke="white" strokeWidth="2" />
                <text x="22" y="34" fill="#374151" className="chart-legend">Opponent</text>
              </g>
              
              {/* Axis labels */}
              <text x="420" y="380" textAnchor="middle" fill="#6b7280" className="chart-axis-title">
                Round
              </text>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
