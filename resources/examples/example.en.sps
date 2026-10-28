* SPSS Studio Example — 60 fictional cases, no real people.
* 1. Select this GET FILE command and click Run, or press Ctrl+Enter (Cmd+Enter on Mac).
* The Example button fills in the SAV path automatically. Run All runs every section.
* Reading this file again restores the original simulated observations.
GET FILE='spss-studio-example.sav'.

* 2. Open Variables and Data in Studio. Double-click a variable name to insert it.
VARIABLE LABELS
 id 'Case identifier'
 age 'Age in years'
 gender 'Simulated gender group'
 edu 'Years of education'
 income 'Simulated monthly income'
 hours 'Weekly working hours'.
VALUE LABELS gender 0 'Group A' 1 'Group B'.
VARIABLE LEVEL id gender (NOMINAL) age edu income hours (SCALE).
FORMATS id (F3.0) age (F2.0) gender (F1.0) edu (F2.0) income (F8.2) hours (F4.1).

* 3. Inspect the dictionary, categories, and descriptive statistics.
CODEBOOK id age gender edu income hours.
FREQUENCIES VARIABLES=gender.
DESCRIPTIVES VARIABLES=age edu income hours
 /STATISTICS=MEAN STDDEV MIN MAX.

* 4. Display a bar chart and a scatterplot in Output.
GRAPH /BAR(SIMPLE)=COUNT BY gender.
GRAPH /SCATTERPLOT(BIVAR)=edu WITH income.

* 5. Compare the two simulated groups with an independent-samples t test.
* Check measurement, distributions, group sizes, and test assumptions in real work.
T-TEST GROUPS=gender(0 1)
 /VARIABLES=income
 /CRITERIA=CI(.95).

* 6. Fit an illustrative regression; these fictional associations are not causal evidence.
REGRESSION
 /DEPENDENT income
 /METHOD=ENTER age gender edu hours.

* 7. Try Explain in Output, or select Syntax and choose Explain in Chat.
* In Variables, select variables and click Explore. Chat needs your own API configuration.
* Chat code blocks offer Copy, Insert, and Run. Review generated code before running it.
* Clear in Output discards all data in this Studio engine, including unsaved edits.
* It preserves original files, output history, and Chat; opening Example alone runs nothing.
