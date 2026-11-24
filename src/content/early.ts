// Runs at document_start: hides the original layout briefly so it does not flash before CSES+ renders.
// A timer always un-hides it, so a failure can never leave the page blank.
if (sessionStorage.getItem('csesplus-off') !== '1') {
  const root = document.documentElement;
  root.classList.add('csesplus-pending');
  setTimeout(() => root.classList.remove('csesplus-pending'), 2500);
}
