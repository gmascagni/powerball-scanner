/**
 * Powerball Prize Evaluation Module
 * Implements official multi-state Powerball payout rules:
 * - Match 5 + PB: Grand Prize (Jackpot)
 * - Match 5: $1,000,000 (With Power Play: $2,000,000 flat)
 * - Match 4 + PB: $50,000 (Multiplied by Power Play)
 * - Match 4: $100 (Multiplied by Power Play)
 * - Match 3 + PB: $100 (Multiplied by Power Play)
 * - Match 3: $7 (Multiplied by Power Play)
 * - Match 2 + PB: $7 (Multiplied by Power Play)
 * - Match 1 + PB: $4 (Multiplied by Power Play)
 * - Match 0 + PB: $4 (Multiplied by Power Play)
 */

export function evaluatePowerballTicket(ticketData, officialDraw) {
  if (!ticketData || !ticketData.plays || ticketData.plays.length === 0) {
    return {
      evaluated: false,
      lines: [],
      total_payout: "$0",
      total_payout_amount: 0,
      is_winner: false,
      jackpot_won: false
    };
  }

  if (!officialDraw || !officialDraw.white_balls || !officialDraw.powerball) {
    return {
      evaluated: false,
      lines: ticketData.plays.map(p => ({
        line_id: p.line_id || "A",
        white_matches: 0,
        matched_white_balls: [],
        powerball_match: false,
        prize_tier: "Awaiting Official Draw",
        payout_amount: 0,
        estimated_payout: "$0"
      })),
      total_payout: "$0",
      total_payout_amount: 0,
      is_winner: false,
      jackpot_won: false
    };
  }

  const officialWhites = new Set(officialDraw.white_balls.map(n => Number(n)));
  const officialPB = Number(officialDraw.powerball);
  const powerPlayMultiplier = officialDraw.power_play_multiplier ? Number(officialDraw.power_play_multiplier) : 1;
  const isPowerPlayTicket = Boolean(ticketData.power_play_active);

  let totalNumericPayout = 0;
  let jackpotWon = false;

  const evaluatedLines = ticketData.plays.map((play) => {
    const playWhites = (play.white_balls || []).map(n => Number(n));
    const playPB = Number(play.powerball);

    // Identify matched white balls
    const matchedWhites = playWhites.filter(n => officialWhites.has(n));
    const whiteMatchCount = matchedWhites.length;
    const pbMatch = playPB === officialPB;

    let prizeTier = "No Prize";
    let basePayout = 0;
    let finalPayout = 0;
    let isGrandPrize = false;

    // Rules Evaluation Matrix
    if (whiteMatchCount === 5 && pbMatch) {
      prizeTier = "Grand Prize (Jackpot)";
      basePayout = officialDraw.jackpot_amount || 20000000;
      finalPayout = basePayout;
      isGrandPrize = true;
      jackpotWon = true;
    } else if (whiteMatchCount === 5 && !pbMatch) {
      prizeTier = "Match 5";
      basePayout = 1000000;
      // Match 5 with Power Play is always fixed at $2,000,000 regardless of multiplier (2X-10X)
      finalPayout = isPowerPlayTicket ? 2000000 : 1000000;
    } else if (whiteMatchCount === 4 && pbMatch) {
      prizeTier = "Match 4 + Powerball";
      basePayout = 50000;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else if (whiteMatchCount === 4 && !pbMatch) {
      prizeTier = "Match 4";
      basePayout = 100;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else if (whiteMatchCount === 3 && pbMatch) {
      prizeTier = "Match 3 + Powerball";
      basePayout = 100;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else if (whiteMatchCount === 3 && !pbMatch) {
      prizeTier = "Match 3";
      basePayout = 7;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else if (whiteMatchCount === 2 && pbMatch) {
      prizeTier = "Match 2 + Powerball";
      basePayout = 7;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else if (whiteMatchCount === 1 && pbMatch) {
      prizeTier = "Match 1 + Powerball";
      basePayout = 4;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else if (whiteMatchCount === 0 && pbMatch) {
      prizeTier = "Match 0 + Powerball";
      basePayout = 4;
      finalPayout = isPowerPlayTicket ? basePayout * powerPlayMultiplier : basePayout;
    } else {
      prizeTier = "No Prize";
      basePayout = 0;
      finalPayout = 0;
    }

    if (!isGrandPrize) {
      totalNumericPayout += finalPayout;
    }

    const estimatedPayoutStr = isGrandPrize 
      ? (officialDraw.jackpot_display || "Grand Prize (Jackpot)")
      : `$${finalPayout.toLocaleString()}`;

    return {
      line_id: play.line_id || "A",
      white_matches: whiteMatchCount,
      matched_white_balls: matchedWhites,
      powerball_match: pbMatch,
      prize_tier: prizeTier,
      base_payout: basePayout,
      payout_amount: finalPayout,
      estimated_payout: estimatedPayoutStr,
      is_winner: finalPayout > 0 || isGrandPrize
    };
  });

  const hasAnyWinner = evaluatedLines.some(l => l.is_winner);
  let totalPayoutDisplay = `$${totalNumericPayout.toLocaleString()}`;
  if (jackpotWon) {
    totalPayoutDisplay = totalNumericPayout > 0 
      ? `Jackpot + $${totalNumericPayout.toLocaleString()}`
      : "Grand Prize (Jackpot)";
  }

  return {
    evaluated: true,
    lines: evaluatedLines,
    total_payout: totalPayoutDisplay,
    total_payout_amount: totalNumericPayout,
    is_winner: hasAnyWinner,
    jackpot_won: jackpotWon
  };
}

/**
 * Produces the exact JSON schema requested by the system
 */
export function buildSchemaResponse(scanStatus, confidenceScore, ticketData, evaluatedResults, notes = "") {
  return {
    scan_status: scanStatus, // "success" | "low_quality" | "unreadable"
    confidence_score: Number((confidenceScore !== undefined ? confidenceScore : 1.0).toFixed(2)),
    ticket_data: {
      draw_date: ticketData?.draw_date || "Unknown",
      power_play_active: Boolean(ticketData?.power_play_active),
      plays: (ticketData?.plays || []).map(p => ({
        line_id: p.line_id || "A",
        white_balls: p.white_balls || [],
        powerball: p.powerball || 0
      }))
    },
    results: {
      evaluated: Boolean(evaluatedResults?.evaluated),
      lines: (evaluatedResults?.lines || []).map(l => ({
        line_id: l.line_id,
        white_matches: l.white_matches,
        powerball_match: l.powerball_match,
        prize_tier: l.prize_tier,
        estimated_payout: l.estimated_payout
      })),
      total_payout: evaluatedResults?.total_payout || "$0",
      is_winner: Boolean(evaluatedResults?.is_winner)
    },
    notes: notes || "Extraction and evaluation completed successfully."
  };
}
