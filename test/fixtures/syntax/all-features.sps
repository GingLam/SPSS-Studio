* A command comment. It can span
  multiple lines and ends here.

COMMENT This is another command comment.
TITLE "Double quoted title."

DATA LIST FREE /id(F8.0) score(F8.2) joined(ADATE10) name(A20).
BEGIN DATA
1 1.25 01/01/2020 "Client's Satisfaction."
2 .50 02/02/2020 'Client''s Satisfaction'
END DATA.

compute #i = -1 + +2 * 3 ** 2.
COMPUTE mixedCase = MEAN.3(score, 1E3, 1E-3, .5).
COMPUTE created = DATE.MDY(1, 2, 2020).
COMPUTE length = CHAR.LENGTH(name).
COMPUTE nested = MAX(ABS(score), SUM(score, 1)).
COMPUTE joined_text = 'one part' + ' another part'.
COMPUTE missing_copy = $SYSMIS.
COMPUTE case_number = $CASENUM.
COMPUTE flagged = 1 /* inline comment */.
MISSING VALUES score (.).

IF (score > .5 AND id NE 2 OR NOT MISSING(score)) selected = 1.
IF (score >= .5 & score <= 10 | id ~= 3) selected = 1.
IF (id <> 4) selected = 1.
DO IF id EQ 1.
  COMPUTE group = 1.
ELSE IF id LE 2.
  COMPUTE group = 2.
ELSE.
  COMPUTE group = 3.
END IF.

LOOP #i = 1 TO 3.
  COMPUTE score = score + #i.
END LOOP.

DO REPEAT source = id score /target = copy_id copy_score.
  COMPUTE target = source.
END REPEAT.

FREQUENCIES VARIABLES=ALL
 /STATISTICS=MEAN MEDIAN
 /UNKNOWNFUTURE=ON.

REGRESSION
 /DEPENDENT score
 /METHOD=ENTER id group
 /STATISTICS COEFF R ANOVA.

T-TEST GROUPS=group(1 2) /VARIABLES=score.
GENLINMIXED score BY group /FIXED=group.
MIXED score BY group /FIXED=group.
CTABLES /TABLE id BY group.
SPATIAL TEMPORAL PREDICTION /VARIABLES=score.
OMS /TAG='fixture' /SELECT ALL /DESTINATION FORMAT=TEXT OUTFILE='fixture.txt'.
OMSEND TAG=['fixture'].

DEFINE !demo (!POSITIONAL !TOKENS(1)).
!IF (!demo !EQ 1) !THEN
FREQUENCIES VARIABLES=id.
!IFEND
!ENDDEFINE.

BEGIN PROGRAM PYTHON3.
print("A Python period. is not an SPSS terminator")
END PROGRAM.

BEGIN GPL.
SOURCE: s=userSource(id("graphdataset"))
END GPL.

MATRIX.
COMPUTE x={1,2;3,4}.
END MATRIX.

MYEXTENSION COMMAND
 /FUTURESUBCOMMAND=YES.
