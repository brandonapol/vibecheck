/// Extracts tests, assertions, and shared setup from a Dart test file, in the
/// shape vibecheck's semantic diff compares (ExtractedTest[] and
/// SetupStatement[]).
///
/// A test is a `test`, `testWidgets`, or `group` call reachable from `main`.
/// An assertion is an `expect` or `expectLater` call; its matcher argument
/// decides the matcher name, and the TypeScript side ranks it.
library;

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/token.dart';
import 'package:analyzer/dart/ast/visitor.dart';

/// Parses [source] and returns `{tests, setup}` ready for JSON encoding.
/// Throws a [FormatException] when the file does not parse, so a broken file
/// is never read as one with no tests.
Map<String, Object?> extract(String source) {
  final result = parseString(content: source, throwIfDiagnostics: false);
  if (result.errors.isNotEmpty) {
    final first = result.errors.first;
    final line = result.lineInfo.getLocation(first.offset).lineNumber;
    throw FormatException('line $line: ${first.message}');
  }
  final extractor = _Extractor(source);
  extractor.run(result.unit);
  return {'tests': extractor.tests, 'setup': extractor.setup};
}

const _registrations = {'test', 'testWidgets', 'group'};
const _assertions = {'expect', 'expectLater'};

/// Matcher identifiers that are not values. Anything else written bare is an
/// expected value, compared with equals.
const _knownMatchers = {
  'anything',
  'isTrue',
  'isFalse',
  'isNull',
  'isNotNull',
  'isEmpty',
  'isNotEmpty',
  'isZero',
  'isNonZero',
  'isNaN',
  'isNotNaN',
  'isPositive',
  'isNegative',
  'isNonPositive',
  'isNonNegative',
  'isList',
  'isMap',
  'returnsNormally',
  'completes',
  'doesNotComplete',
  'throwsException',
  'throwsArgumentError',
  'throwsStateError',
  'throwsFormatException',
  'throwsUnsupportedError',
  'throwsUnimplementedError',
  'throwsRangeError',
  'throwsNoSuchMethodError',
  'throwsConcurrentModificationError',
  'throwsCyclicInitializationError',
  'throwsNullThrownError',
  'throwsFlutterError',
  'throwsAssertionError',
  'throws',
  'findsOneWidget',
  'findsNothing',
  'findsWidgets',
  'findsAny',
  'findsOne',
  'neverEmits',
  'emitsDone',
  'emitsError',
};

/// Matcher constructors called as functions. Any other call in matcher
/// position computes an expected value, compared with equals.
const _functionMatchers = {
  'equals',
  'same',
  'hasLength',
  'closeTo',
  'contains',
  'startsWith',
  'endsWith',
  'matches',
  'isA',
  'isIn',
  'everyElement',
  'anyElement',
  'predicate',
  'allOf',
  'anyOf',
  'isNot',
  'throwsA',
  'greaterThan',
  'greaterThanOrEqualTo',
  'lessThan',
  'lessThanOrEqualTo',
  'inInclusiveRange',
  'inExclusiveRange',
  'inClosedOpenRange',
  'inOpenClosedRange',
  'containsAll',
  'containsPair',
  'containsAllInOrder',
  'orderedEquals',
  'unorderedEquals',
  'unorderedMatches',
  'equalsIgnoringCase',
  'equalsIgnoringWhitespace',
  'stringContainsInOrder',
  'findsNWidgets',
  'findsExactly',
  'findsAtLeastNWidgets',
  'findsAtLeast',
  'matchesGoldenFile',
  'emits',
  'emitsInOrder',
  'emitsError',
  'emitsAnyOf',
  'emitsThrough',
  'completion',
  'having',
  'wrapMatcher',
};

/// A bare identifier shaped like a matcher (`isValidUser`, `hasTitle`) is a
/// custom matcher, not a value.
final _customMatcherName = RegExp(
  r'^(is|has|finds|throws|matches|returns|completes|emits|contains)[A-Z_]',
);

/// Matchers with nothing meaningful to loosen, like Jest's toBeDefined().
const _noExpectedValue = {
  'anything',
  'isTrue',
  'isFalse',
  'isNull',
  'isNotNull',
  'isEmpty',
  'isNotEmpty',
  'isZero',
  'isNonZero',
  'isNaN',
  'isNotNaN',
  'isPositive',
  'isNegative',
  'isNonPositive',
  'isNonNegative',
  'returnsNormally',
  'completes',
  'throwsException',
  'throws',
  'findsOneWidget',
  'findsNothing',
  'findsWidgets',
  'findsAny',
  'findsOne',
  'throwsAnything',
};

class _Extractor {
  _Extractor(this.source);

  final String source;
  final tests = <Map<String, Object?>>[];
  final setup = <Map<String, Object?>>[];

  void run(CompilationUnit unit) {
    final librarySkipped = unit.directives.any(
      (d) => d.metadata.any((a) => a.name.name == 'Skip'),
    );
    for (final declaration in unit.declarations) {
      if (declaration is FunctionDeclaration &&
          declaration.name.lexeme == 'main') {
        final body = declaration.functionExpression.body;
        if (body is BlockFunctionBody) {
          _collectScope(body.block.statements, const [], librarySkipped);
        }
        continue;
      }
      setup.add({'key': _key(declaration), 'source': _source(declaration)});
    }
  }

  /// Walks `main` or a group body: registrations become tests and groups,
  /// anything else is shared setup.
  void _collectScope(
    List<Statement> statements,
    List<String> path,
    bool skipped,
  ) {
    for (final statement in statements) {
      final call = _registrationIn(statement);
      if (call == null) {
        setup.add({'key': _key(statement), 'source': _source(statement)});
        // Tests registered inside setup code (a loop over cases) still count.
        statement.accept(_RegistrationFinder(this, path, skipped));
        continue;
      }
      _register(call, path, skipped);
    }
  }

  void _register(MethodInvocation call, List<String> path, bool parentSkipped) {
    final args = call.argumentList.arguments;
    final positional = args.whereType<Expression>().toList();
    if (positional.isEmpty) return;
    final name = _name(positional.first);
    final skipped = parentSkipped || _hasSkip(args);
    final body = positional.length > 1 ? positional[1] : null;

    if (call.methodName.name == 'group') {
      final groupBody = body is FunctionExpression ? body.body : null;
      if (groupBody is BlockFunctionBody) {
        _collectScope(groupBody.block.statements, [...path, name], skipped);
      }
      return;
    }

    final scanner = _AssertionScanner(this);
    if (body is FunctionExpression) body.body.accept(scanner);
    tests.add({
      'name': name,
      'describePath': path,
      'id': [...path, name].join(' > '),
      'skipped': skipped,
      'assertions': scanner.assertions,
      'suspicious': <String>[],
      'bodyKey': body == null ? '' : _key(body, masked: scanner.masked),
    });
  }

  MethodInvocation? _registrationIn(Statement statement) {
    if (statement is! ExpressionStatement) return null;
    final expression = statement.expression;
    return expression is MethodInvocation && _isRegistration(expression)
        ? expression
        : null;
  }

  bool _isRegistration(MethodInvocation call) =>
      call.target == null && _registrations.contains(call.methodName.name);

  /// `skip: false` and `skip: null` run the test; any other value, including
  /// one only known at run time, may skip it.
  bool _hasSkip(NodeList<Argument> args) {
    for (final arg in args) {
      if (arg is NamedArgument && arg.name.lexeme == 'skip') {
        final value = arg.argumentExpression;
        if (value is NullLiteral) return false;
        if (value is BooleanLiteral) return value.value;
        return true;
      }
    }
    return false;
  }

  String _name(Expression expression) => expression is SimpleStringLiteral
      ? expression.value
      : _source(expression);

  String _source(AstNode node) => source.substring(node.offset, node.end);

  /// Joins token lexemes, so formatting and comments never change a key.
  /// Trailing commas are dropped because the formatter adds and removes them.
  String _key(AstNode node, {Map<AstNode, String> masked = const {}}) {
    final starts = {
      for (final entry in masked.entries) entry.key.beginToken: entry,
    };
    final buffer = StringBuffer();
    Token? token = node.beginToken;
    final end = node.endToken;
    while (token != null) {
      final mask = starts[token];
      if (mask != null) {
        buffer.write('${mask.value} ');
        if (identical(mask.key.endToken, end)) break;
        token = mask.key.endToken.next;
        continue;
      }
      final isTrailingComma =
          token.type == TokenType.COMMA &&
          const {
            TokenType.CLOSE_PAREN,
            TokenType.CLOSE_SQUARE_BRACKET,
            TokenType.CLOSE_CURLY_BRACKET,
          }.contains(token.next?.type);
      if (!isTrailingComma) buffer.write('${token.lexeme} ');
      if (identical(token, end)) break;
      token = token.next;
    }
    return buffer.toString();
  }
}

class _RegistrationFinder extends RecursiveAstVisitor<void> {
  _RegistrationFinder(this.extractor, this.path, this.skipped);

  final _Extractor extractor;
  final List<String> path;
  final bool skipped;

  @override
  void visitMethodInvocation(MethodInvocation node) {
    if (extractor._isRegistration(node)) {
      extractor._register(node, path, skipped);
      return;
    }
    super.visitMethodInvocation(node);
  }
}

class _AssertionScanner extends RecursiveAstVisitor<void> {
  _AssertionScanner(this.extractor);

  final _Extractor extractor;
  final assertions = <Map<String, Object?>>[];
  final masked = <AstNode, String>{};
  int _conditional = 0;

  void _conditionally(AstNode? node) {
    if (node == null) return;
    _conditional++;
    node.accept(this);
    _conditional--;
  }

  @override
  void visitIfStatement(IfStatement node) {
    node.expression.accept(this);
    node.caseClause?.accept(this);
    _conditionally(node.thenStatement);
    _conditionally(node.elseStatement);
  }

  @override
  void visitConditionalExpression(ConditionalExpression node) {
    node.condition.accept(this);
    _conditionally(node.thenExpression);
    _conditionally(node.elseExpression);
  }

  @override
  void visitBinaryExpression(BinaryExpression node) {
    final shortCircuit =
        node.operator.type == TokenType.AMPERSAND_AMPERSAND ||
        node.operator.type == TokenType.BAR_BAR ||
        node.operator.type == TokenType.QUESTION_QUESTION;
    if (!shortCircuit) return super.visitBinaryExpression(node);
    node.leftOperand.accept(this);
    _conditionally(node.rightOperand);
  }

  @override
  void visitForStatement(ForStatement node) {
    final parts = node.forLoopParts;
    node.forLoopParts.accept(this);
    final iterable = parts is ForEachParts ? parts.iterable : null;
    final alwaysRuns = iterable is ListLiteral && iterable.elements.isNotEmpty;
    alwaysRuns ? node.body.accept(this) : _conditionally(node.body);
  }

  @override
  void visitWhileStatement(WhileStatement node) {
    node.condition.accept(this);
    _conditionally(node.body);
  }

  @override
  void visitSwitchStatement(SwitchStatement node) {
    node.expression.accept(this);
    for (final member in node.members) {
      _conditionally(member);
    }
  }

  @override
  void visitSwitchExpression(SwitchExpression node) {
    node.expression.accept(this);
    for (final c in node.cases) {
      _conditionally(c);
    }
  }

  @override
  void visitTryStatement(TryStatement node) {
    final swallows = node.catchClauses.any((c) => !_rethrows(c.body));
    swallows ? _conditionally(node.body) : node.body.accept(this);
    for (final clause in node.catchClauses) {
      _conditionally(clause);
    }
    node.finallyBlock?.accept(this);
  }

  bool _rethrows(Block block) => block.statements.any(
    (s) =>
        s is ExpressionStatement &&
        (s.expression is RethrowExpression || s.expression is ThrowExpression),
  );

  @override
  void visitMethodInvocation(MethodInvocation node) {
    if (node.target == null && _assertions.contains(node.methodName.name)) {
      _record(node);
      return;
    }
    super.visitMethodInvocation(node);
  }

  void _record(MethodInvocation call) {
    final positional = call.argumentList.arguments
        .whereType<Expression>()
        .toList();
    if (positional.length < 2) return;
    final actual = positional[0];
    final matcher = positional[1];
    final kind = _classify(matcher);
    masked[call] = '<assertion>';
    assertions.add({
      'matcher': kind.name,
      'modifiers': <String>[],
      'tautological': _tautological(actual, matcher, kind.name),
      'conditional': _conditional > 0,
      'hasArguments': !_noExpectedValue.contains(kind.name),
      'key':
          '${call.methodName.name}(${extractor._key(actual)}|${extractor._key(matcher)})',
      'source': extractor._source(call),
    });
  }

  ({String name}) _classify(Expression matcher) {
    if (matcher is MethodInvocation) {
      final name = matcher.methodName.name;
      if (!_functionMatchers.contains(name) &&
          !_customMatcherName.hasMatch(name)) {
        return (name: 'equals');
      }
      if (name == 'throwsA') {
        final inner = matcher.argumentList.arguments
            .whereType<Expression>()
            .firstOrNull;
        final anything =
            inner == null ||
            (inner is SimpleIdentifier && inner.name == 'anything');
        return (name: anything ? 'throwsAnything' : 'throwsA');
      }
      return (name: name);
    }
    if (matcher is SimpleIdentifier)
      return (name: _identifierMatcher(matcher.name));
    if (matcher is PrefixedIdentifier)
      return (name: _identifierMatcher(matcher.identifier.name));
    if (matcher is InstanceCreationExpression) {
      final type = matcher.constructorName.type.name.lexeme;
      return (name: type.endsWith('Matcher') ? type : 'equals');
    }
    return (name: 'equals');
  }

  String _identifierMatcher(String name) =>
      _knownMatchers.contains(name) || _customMatcherName.hasMatch(name)
      ? name
      : 'equals';

  /// Comparing something to itself or to a constant it already is. Calls are
  /// exempt so `expect(instance(), instance())` stays a valid identity check.
  bool _tautological(Expression actual, Expression matcher, String kind) {
    if (kind == 'anything') return true;
    final expected =
        matcher is MethodInvocation && matcher.methodName.name == 'equals'
        ? matcher.argumentList.arguments.whereType<Expression>().firstOrNull
        : kind == 'equals'
        ? matcher
        : null;
    if (_isConstant(actual)) {
      if (expected != null && _isConstant(expected)) return true;
      if (actual is BooleanLiteral && (kind == 'isTrue' || kind == 'isFalse'))
        return true;
    }
    if (expected != null && !_hasCall(actual)) {
      return extractor._key(actual) == extractor._key(expected);
    }
    return false;
  }

  /// A scalar written out in the source. Collection and record literals are
  /// not: their elements can be computed.
  bool _isConstant(Expression e) =>
      e is BooleanLiteral ||
      e is IntegerLiteral ||
      e is DoubleLiteral ||
      e is SimpleStringLiteral ||
      e is NullLiteral ||
      (e is PrefixExpression &&
          e.operator.type == TokenType.MINUS &&
          _isConstant(e.operand));

  bool _hasCall(Expression e) {
    var found = false;
    e.accept(_CallFinder(() => found = true));
    return found || e is MethodInvocation || e is FunctionExpressionInvocation;
  }
}

class _CallFinder extends RecursiveAstVisitor<void> {
  _CallFinder(this.onCall);

  final void Function() onCall;

  @override
  void visitMethodInvocation(MethodInvocation node) => onCall();

  @override
  void visitFunctionExpressionInvocation(FunctionExpressionInvocation node) =>
      onCall();

  @override
  void visitInstanceCreationExpression(InstanceCreationExpression node) =>
      onCall();
}
