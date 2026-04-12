#!/bin/bash
# Keep running after test failure so coverage/allure artifacts are still generated.
set +e

npm run test:ui
test_exit=$?

npm run test:ui:coverage
coverage_exit=$?

npm run test:ui:allure
allure_exit=$?

if [ $test_exit -ne 0 ]; then
  exit $test_exit
fi

if [ $coverage_exit -ne 0 ]; then
  exit $coverage_exit
fi

exit $allure_exit
