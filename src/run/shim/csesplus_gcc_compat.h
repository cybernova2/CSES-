// Force-included (-include) in every local C++ build. Provides GCC/libstdc++ helpers that common
// competitive-programming code uses but libc++ lacks. Local Run only; CSES itself uses real GCC.
#ifndef CSESPLUS_GCC_COMPAT_H
#define CSESPLUS_GCC_COMPAT_H
#ifdef __cplusplus
#include <type_traits>
namespace std {
// libstdc++: std::__gcd (from <algorithm>)
template <class T>
constexpr T __gcd(T a, T b) {  // single return statement: valid C++11 constexpr
  return b == 0 ? a : __gcd(b, T(a % b));
}
// libstdc++: std::__lg = floor(log2(n)) for n > 0
constexpr int __lg(int n) { return 31 - __builtin_clz((unsigned)n); }
constexpr long __lg(long n) { return (long)(sizeof(long) * 8 - 1) - __builtin_clzl((unsigned long)n); }
constexpr long long __lg(long long n) { return 63 - __builtin_clzll((unsigned long long)n); }
constexpr unsigned __lg(unsigned n) { return 31 - __builtin_clz(n); }
constexpr unsigned long long __lg(unsigned long long n) { return 63 - __builtin_clzll(n); }
}  // namespace std
#endif
#endif
